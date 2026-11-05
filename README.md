# Clinic Booking API

A RESTful clinic appointment booking API built with Python, FastAPI, PostgreSQL, and SQLAlchemy.

This project was developed for the Koya AI Automation Developer Program Cohort 4 assessment.

## Features

- View available appointment slots.
- Filter appointment slots by provider.
- Book appointments using patient details.
- Retrieve individual bookings.
- Secure API endpoints using API key authentication.
- Validate booking requests and reject invalid input.
- Prevent double-booking using database constraints and transactions.
- Cancel existing bookings and release appointment slots.
- Prevent duplicate bookings caused by retried requests using idempotency keys.
- Retrieve bookings with cursor-based pagination.
- Limit booking attempts to five per email within 60 seconds.
- Return HTTP 429 and a `Retry-After` header when rate limits are exceeded.

## Technologies Used

- Python
- FastAPI
- PostgreSQL
- SQLAlchemy
- Pydantic
- Uvicorn
- Render

## Installation

Clone the repository:

```bash
git clone https://github.com/Crownezt/clinic-booking-api.git
cd clinic-booking-api
```

Create a virtual environment:

```bash
python -m venv venv
```

Activate the virtual environment on Windows:

```powershell
.\venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

## Environment Variables

Configure the following environment variables:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/clinic_booking
API_KEY=your_secure_api_key
```

Replace the example values with your actual database connection details and a secure API key.

Never commit real credentials to GitHub.

## Running the Application

Start the FastAPI development server:

```bash
uvicorn main:app --reload
```

Open the interactive API documentation at:

`http://127.0.0.1:8000/docs`

## API Authentication

Protected API endpoints require the following request header:

```http
X-API-Key: your_secure_api_key
```

Requests with missing or invalid API keys return HTTP 401.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/reset` | Reset appointment slots and booking data |
| GET | `/slots` | Retrieve appointment slots |
| POST | `/bookings` | Create an appointment booking |
| GET | `/bookings/{id}` | Retrieve a booking by ID |
| DELETE | `/bookings/{id}` | Cancel a booking |
| GET | `/bookings` | Retrieve bookings by email with pagination |

## Example Booking Request

**POST `/bookings`**

```json
{
  "slot_id": "slot-001",
  "name": "Test Patient",
  "email": "patient@example.com"
}
```

Successful bookings return HTTP 201.

## Idempotency

To prevent duplicate bookings when requests are retried, include an idempotency key:

```http
Idempotency-Key: unique-request-key
```

Retrying with the same key and request details returns the original response.

Reusing the same key with different booking details returns HTTP 422.

## Pagination

Retrieve bookings using an email address:

```http
GET /bookings?email=patient@example.com&limit=10
```

Use the returned `next_cursor` to request subsequent pages.

The maximum page size is 50 bookings.

## Rate Limiting

The API allows a maximum of five booking attempts per email within 60 seconds.

When the limit is exceeded, the API returns:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

## Testing

The following functionality has been manually tested:

- API key authentication.
- Booking input validation.
- Appointment creation.
- Concurrent booking attempts.
- Booking cancellation.
- Slot availability after cancellation.
- Idempotency key reuse.
- Cursor-based pagination.
- Booking rate limiting.
- `Retry-After` response header.

## Deployment

The application is deployed on Render using PostgreSQL.

**Live API:**

`https://clinic-booking-api-yh2w.onrender.com`

**Swagger Documentation:**

`https://clinic-booking-api-yh2w.onrender.com/docs`

**GitHub Repository:**

`https://github.com/Crownezt/clinic-booking-api`

## Author

