from sqlalchemy import (
    Column, String, DateTime, ForeignKey, Integer,
    Index, JSON, text
)
from database import Base


class Slot(Base):
    __tablename__ = "slots"

    id = Column(String, primary_key=True)
    provider = Column(String, nullable=False)
    start = Column(DateTime(timezone=True), nullable=False)
    end = Column(DateTime(timezone=True), nullable=False)


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(String, primary_key=True)
    slot_id = Column(String, ForeignKey("slots.id"), nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="confirmed")
    created_at = Column(DateTime(timezone=True), nullable=False)


Index(
    "unique_confirmed_booking_per_slot",
    Booking.slot_id,
    unique=True,
    postgresql_where=text("status = 'confirmed'"),
    sqlite_where=text("status = 'confirmed'"),
)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"

    key = Column(String, primary_key=True)
    request_hash = Column(String, nullable=False)
    response = Column(JSON, nullable=False)
    status_code = Column(Integer, nullable=False)


class BookingAttempt(Base):
    __tablename__ = "booking_attempts"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, index=True)
    attempted_at = Column(DateTime(timezone=True), nullable=False)