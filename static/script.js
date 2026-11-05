const apiKeyInput = document.getElementById("apiKey");
const slotsContainer = document.getElementById("slots");
const bookingSection = document.getElementById("bookingSection");
const bookingForm = document.getElementById("bookingForm");
const confirmation = document.getElementById("confirmation");
const message = document.getElementById("message");

let selectedSlot = null;

function showMessage(text) {
    message.textContent = text;
}

function getHeaders() {
    return {
        "Content-Type": "application/json",
        "X-API-Key": apiKeyInput.value.trim()
    };
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...getHeaders(),
            ...(options.headers || {})
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Request failed");
    }

    return data;
}

function formatDate(date) {
    return new Date(date).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

async function loadSlots() {
    showMessage("");

    if (!apiKeyInput.value.trim()) {
        showMessage("Please enter your API key.");
        return;
    }

    slotsContainer.textContent = "Loading appointments...";

    try {
        const data = await apiRequest("/slots");

        slotsContainer.replaceChildren();

        if (data.slots.length === 0) {
            slotsContainer.textContent =
                "No appointment slots are currently available.";
            return;
        }

        data.slots.forEach(slot => {
            const card = document.createElement("div");
            card.className = "slot";

            const title = document.createElement("h3");
            title.textContent = slot.provider;

            const time = document.createElement("p");
            time.textContent =
                `${formatDate(slot.start)} - ${formatDate(slot.end)}`;

            const button = document.createElement("button");
            button.className = "btn";

            const isPast = new Date(slot.start) <= new Date();
            const canBook = slot.available && !isPast;

            button.textContent = canBook
                ? "Book Appointment"
                : "Unavailable";

            button.disabled = !canBook;

            button.addEventListener("click", () => {
                selectedSlot = slot;

                document.getElementById("selectedSlot").textContent =
                    `${slot.provider} — ${formatDate(slot.start)}`;

                bookingSection.hidden = false;
                confirmation.hidden = true;

                bookingSection.scrollIntoView({
                    behavior: "smooth"
                });
            });

            card.append(title, time, button);

            if (!canBook) {
                card.classList.add("unavailable");
            }

            slotsContainer.appendChild(card);
        });

    } catch (error) {
        slotsContainer.replaceChildren();
        showMessage(error.message);
    }
}

document.getElementById("loadSlots")
    .addEventListener("click", loadSlots);

bookingForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!selectedSlot) {
        showMessage("Please select an appointment slot.");
        return;
    }

    const button = bookingForm.querySelector("button");
    button.disabled = true;

    showMessage("");

    const payload = {
        slot_id: selectedSlot.id,
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim()
    };

    try {
        const booking = await apiRequest("/bookings", {
            method: "POST",
            body: JSON.stringify(payload),
            headers: {
                "Idempotency-Key": crypto.randomUUID()
            }
        });

        bookingSection.hidden = true;
        confirmation.hidden = false;

        const details = document.getElementById(
            "confirmationDetails"
        );

        details.replaceChildren();

        const fields = [
            ["Booking ID", booking.id],
            ["Patient", booking.name],
            ["Email", booking.email],
            ["Status", booking.status],
            ["Appointment", formatDate(selectedSlot.start)]
        ];

        fields.forEach(([label, value]) => {
            const row = document.createElement("p");
            const strong = document.createElement("strong");

            strong.textContent = `${label}: `;
            row.append(strong, document.createTextNode(value));

            details.appendChild(row);
        });

        bookingForm.reset();
        selectedSlot = null;

        await loadSlots();

        confirmation.scrollIntoView({
            behavior: "smooth"
        });

    } catch (error) {
        showMessage(error.message);
    } finally {
        button.disabled = false;
    }
});

document.getElementById("bookAnother")
    .addEventListener("click", () => {
        confirmation.hidden = true;
        bookingSection.hidden = true;
        loadSlots();
    });