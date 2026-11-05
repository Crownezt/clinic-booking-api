import hashlib
import json
import math
import os
import uuid

from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from sqlalchemy import select, delete, func, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from starlette.staticfiles import StaticFiles

from database import Base, engine, SessionLocal
from models import Slot, Booking, IdempotencyRecord, BookingAttempt
from schemas import ResetRequest, BookingRequest

load_dotenv()

API_KEY = os.getenv("API_KEY")

if not API_KEY:
    raise RuntimeError("API_KEY must be configured")


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Clinic Booking API", lifespan=lifespan)


def utcnow():
    return datetime.now(timezone.utc)


def as_utc(value):
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def iso(value):
    return as_utc(value).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def error(status, message, headers=None):
    raise HTTPException(
        status_code=status,
        detail=message,
        headers=headers,
    )


@app.exception_handler(HTTPException)
async def http_error_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": str(exc.detail)},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    return JSONResponse(
        status_code=400,
        content={"error": "invalid request"},
    )


@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    public_paths = {
        "/",
        "/docs",
        "/openapi.json",
        "/docs/oauth2-redirect",
        "/favicon.ico",
    }

    if (
        request.url.path in public_paths
        or request.url.path.startswith("/static/")
    ):
        return await call_next(request)

    api_key = request.headers.get("X-API-Key")

    if api_key != API_KEY:
        return JSONResponse(
            status_code=401,
            content={"error": "unauthorized"},
        )

    return await call_next(request)

def booking_dict(booking):
    return {
        "id": booking.id,
        "slot_id": booking.slot_id,
        "name": booking.name,
        "email": booking.email,
        "status": booking.status,
        "created_at": iso(booking.created_at),
    }


def slot_dict(db, slot):
    occupied = db.scalar(
        select(Booking.id).where(
            Booking.slot_id == slot.id,
            Booking.status == "confirmed",
        )
    )

    return {
        "id": slot.id,
        "provider": slot.provider,
        "start": iso(slot.start),
        "end": iso(slot.end),
        "available": occupied is None,
    }


@app.post("/reset")
def reset(payload: ResetRequest):
    ids = [slot.id for slot in payload.slots]

    if len(ids) != len(set(ids)):
        error(400, "duplicate slot id")

    with SessionLocal.begin() as db:
        db.execute(delete(IdempotencyRecord))
        db.execute(delete(BookingAttempt))
        db.execute(delete(Booking))
        db.execute(delete(Slot))

        for item in payload.slots:
            db.add(
                Slot(
                    id=item.id,
                    provider=item.provider,
                    start=item.start,
                    end=item.end,
                )
            )

    return {"slots": len(payload.slots)}


@app.get("/slots")
def list_slots(provider: str | None = None):
    with SessionLocal() as db:
        statement = select(Slot).order_by(Slot.start, Slot.id)

        if provider is not None:
            statement = statement.where(Slot.provider == provider)

        slots = db.scalars(statement).all()

        return {"slots": [slot_dict(db, slot) for slot in slots]}


@app.post("/bookings", status_code=201)
def create_booking(
    payload: BookingRequest,
    idempotency_key: str | None = Header(default=None),
):
    slot_id = payload.slot_id.strip()
    name = payload.name.strip()
    email = str(payload.email).strip().lower()

    if not slot_id or not name:
        error(400, "invalid booking details")

    normalized = {
        "slot_id": slot_id,
        "name": name,
        "email": email,
    }

    request_hash = hashlib.sha256(
        json.dumps(normalized, sort_keys=True).encode()
    ).hexdigest()

    now = utcnow()

    # First, check whether this request has already been processed.
    if idempotency_key:
        with SessionLocal() as db:
            existing = db.get(IdempotencyRecord, idempotency_key)

            if existing:
                if existing.request_hash != request_hash:
                    error(422, "idempotency key reused with different request")

                return JSONResponse(
                    status_code=existing.status_code,
                    content=existing.response,
                )

    # Record attempts separately so failed bookings are counted.
    with SessionLocal.begin() as db:
        if engine.dialect.name == "postgresql":
            db.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:email))"),
                {"email": email},
            )

        window_start = now - timedelta(minutes=1)

        recent_attempts = db.scalars(
            select(BookingAttempt.attempted_at)
            .where(
                BookingAttempt.email == email,
                BookingAttempt.attempted_at > window_start,
            )
            .order_by(BookingAttempt.attempted_at)
        ).all()

        if len(recent_attempts) >= 5:
            retry_after = max(
                1,
                math.ceil(
                    (
                        as_utc(recent_attempts[0])
                        + timedelta(minutes=1)
                        - now
                    ).total_seconds()
                ),
            )

            rate_limit_response = JSONResponse(
                status_code=429,
                content={"error": "too many booking attempts"},
                headers={"Retry-After": str(retry_after)},
            )

        else:
            db.add(
                BookingAttempt(
                    id=str(uuid.uuid4()),
                    email=email,
                    attempted_at=now,
                )
            )
            rate_limit_response = None

    if rate_limit_response is not None:
        return rate_limit_response

    try:
        with SessionLocal.begin() as db:
            if engine.dialect.name == "postgresql":
                # Serialize requests using the same idempotency key.
                if idempotency_key:
                    db.execute(
                        text(
                            "SELECT pg_advisory_xact_lock("
                            "hashtext(:key))"
                        ),
                        {"key": "idempotency:" + idempotency_key},
                    )

                # Prevent simultaneous bookings for the same slot.
                db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:slot))"),
                    {"slot": "slot:" + slot_id},
                )

            if idempotency_key:
                existing = db.get(IdempotencyRecord, idempotency_key)

                if existing:
                    if existing.request_hash != request_hash:
                        result_status = 422
                        result = {
                            "error": "idempotency key reused with different request"
                        }
                    else:
                        result_status = existing.status_code
                        result = existing.response

                    return JSONResponse(
                        status_code=result_status,
                        content=result,
                    )

            slot = db.get(Slot, slot_id)

            if not slot:
                result_status = 404
                result = {"error": "slot not found"}

            elif as_utc(slot.start) <= utcnow():
                result_status = 400
                result = {"error": "slot has already started"}

            else:
                occupied = db.scalar(
                    select(Booking.id).where(
                        Booking.slot_id == slot_id,
                        Booking.status == "confirmed",
                    )
                )

                if occupied:
                    result_status = 409
                    result = {"error": "slot already booked"}

                else:
                    booking = Booking(
                        id=str(uuid.uuid4()),
                        slot_id=slot_id,
                        name=name,
                        email=email,
                        status="confirmed",
                        created_at=utcnow(),
                    )

                    db.add(booking)
                    db.flush()

                    result_status = 201
                    result = booking_dict(booking)

            if idempotency_key:
                db.add(
                    IdempotencyRecord(
                        key=idempotency_key,
                        request_hash=request_hash,
                        response=result,
                        status_code=result_status,
                    )
                )

        return JSONResponse(
            status_code=result_status,
            content=result,
        )

    except IntegrityError:
        # A database uniqueness constraint prevents double booking.
        error(409, "slot already booked")
        

@app.get("/bookings")
def list_bookings(
    email: str = Query(...),
    limit: int = Query(default=10),
    cursor: str | None = None,
):
    if limit < 1 or limit > 50:
        error(400, "invalid limit")

    email = email.strip().lower()

    with SessionLocal() as db:
        statement = (
            select(Booking)
            .where(Booking.email == email)
            .order_by(Booking.created_at, Booking.id)
        )

        if cursor:
            previous = db.get(Booking, cursor)

            if not previous or previous.email != email:
                error(400, "invalid cursor")

            statement = statement.where(
                (Booking.created_at > previous.created_at)
                | (
                    (Booking.created_at == previous.created_at)
                    & (Booking.id > previous.id)
                )
            )

        records = db.scalars(statement.limit(limit + 1)).all()

        has_more = len(records) > limit
        records = records[:limit]

        return {
            "bookings": [booking_dict(b) for b in records],
            "next_cursor": records[-1].id if has_more else None,
        }


@app.get("/bookings/{id}")
def get_booking(id: str):
    with SessionLocal() as db:
        booking = db.get(Booking, id)

        if not booking:
            error(404, "booking not found")

        return booking_dict(booking)


@app.delete("/bookings/{id}")
def cancel_booking(id: str):
    with SessionLocal.begin() as db:
        statement = select(Booking).where(Booking.id == id)

        if engine.dialect.name == "postgresql":
            statement = statement.with_for_update()

        booking = db.scalar(statement)

        if not booking:
            error(404, "booking not found")

        if booking.status == "cancelled":
            error(409, "booking already cancelled")

        booking.status = "cancelled"
        db.flush()

        result = booking_dict(booking)

    return result


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", include_in_schema=False)
def homepage():
    return FileResponse("static/index.html")