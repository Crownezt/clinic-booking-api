from datetime import datetime
from pydantic import BaseModel, Field, EmailStr


class SlotInput(BaseModel):
    id: str
    provider: str
    start: datetime
    end: datetime


class ResetRequest(BaseModel):
    slots: list[SlotInput]


class BookingRequest(BaseModel):
    slot_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    email: EmailStr