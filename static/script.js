const apiKeyInput = document.getElementById("apiKey");
const slotsContainer = document.getElementById("slots");
const bookingSection = document.getElementById("bookingSection");
const bookingForm = document.getElementById("bookingForm");
const confirmation = document.getElementById("confirmation");
const message = document.getElementById("message");
const providerFilter = document.getElementById("providerFilter");

let selectedSlot = null;
let allSlots = [];
let historyEmail = "";
let historyLimit = 10;
let pageCursors = [null];
let currentPage = 0;
let nextCursor = null;
let lastDemoRequest = null;

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
    if (!apiKeyInput.value.trim()) {
        throw new Error("Please enter your API key first.");
    }

    const response = await fetch(url, {
        ...options,
        headers: {
            ...getHeaders(),
            ...(options.headers || {})
        }
    });

    let data;

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {
        throw new Error(
            data.error || `Request failed (HTTP ${response.status})`
        );
    }

    return data;
}

function formatDate(date) {
    return new Date(date).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function clear(element) {
    element.replaceChildren();
}

function textNode(tag, text, className = "") {
    const element = document.createElement(tag);

    element.textContent = String(text);

    if (className) {
        element.className = className;
    }

    return element;
}

function showError(element, error) {
    clear(element);
    element.appendChild(
        textNode("p", error.message, "error-text")
    );
}

function renderBooking(element, booking) {
    const record = document.createElement("div");
    record.className = "record";

    const fields = [
        ["Booking ID", booking.id],
        ["Slot ID", booking.slot_id],
        ["Patient", booking.name],
        ["Email", booking.email],
        ["Status", booking.status],
        ["Created", formatDate(booking.created_at)]
    ];

    fields.forEach(([label, value]) => {
        const row = document.createElement("p");

        row.append(
            textNode("strong", `${label}: `),
            document.createTextNode(String(value))
        );

        record.appendChild(row);
    });

    element.appendChild(record);
}

function populateSlotControls() {
    const previousProvider = providerFilter.value;

    clear(providerFilter);

    providerFilter.appendChild(
        new Option("All doctors", "")
    );

    const providers = [
        ...new Set(allSlots.map(slot => slot.provider))
    ].sort();

    providers.forEach(provider => {
        providerFilter.appendChild(
            new Option(provider, provider)
        );
    });

    if (
        [...providerFilter.options].some(
            option => option.value === previousProvider
        )
    ) {
        providerFilter.value = previousProvider;
    }

    const demoSlot = document.getElementById("demoSlot");
    const oldValue = demoSlot.value;

    clear(demoSlot);

    demoSlot.appendChild(
        new Option("Select an available slot", "")
    );

    allSlots
        .filter(
            slot =>
                slot.available &&
                new Date(slot.start) > new Date()
        )
        .forEach(slot => {
            demoSlot.appendChild(
                new Option(
                    `${slot.id} — ${slot.provider} — ${formatDate(slot.start)}`,
                    slot.id
                )
            );
        });

    if (
        [...demoSlot.options].some(
            option => option.value === oldValue
        )
    ) {
        demoSlot.value = oldValue;
    }
}

function renderSlots() {
    clear(slotsContainer);

    const filtered = allSlots.filter(
        slot =>
            !providerFilter.value ||
            slot.provider === providerFilter.value
    );

    if (!filtered.length) {
        slotsContainer.textContent =
            "No appointment slots match your selection.";
        return;
    }

    filtered.forEach(slot => {
        const card = document.createElement("div");
        card.className = "slot";

        const title = textNode("h3", slot.provider);

        const time = textNode(
            "p",
            `${formatDate(slot.start)} - ${formatDate(slot.end)}`
        );

        const button = document.createElement("button");
        button.className = "btn";

        const canBook =
            slot.available &&
            new Date(slot.start) > new Date();

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
}

async function loadSlots() {
    showMessage("");

    slotsContainer.textContent = "Loading appointments...";

    try {
        const data = await apiRequest("/slots");

        allSlots = data.slots;

        populateSlotControls();
        renderSlots();

    } catch (error) {
        clear(slotsContainer);
        showMessage(error.message);
    }
}

document.getElementById("loadSlots")
    .addEventListener("click", loadSlots);

providerFilter.addEventListener("change", renderSlots);


// CREATE BOOKING

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

        clear(details);

        const fields = [
            ["Booking ID", booking.id],
            ["Patient", booking.name],
            ["Email", booking.email],
            ["Status", booking.status],
            ["Appointment", formatDate(selectedSlot.start)]
        ];

        fields.forEach(([label, value]) => {
            const row = document.createElement("p");

            row.append(
                textNode("strong", `${label}: `),
                document.createTextNode(String(value))
            );

            details.appendChild(row);
        });

        // Fill the other forms automatically.
        document.getElementById("lookupId").value = booking.id;
        document.getElementById("cancelId").value = booking.id;
        document.getElementById("historyEmail").value = booking.email;

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


// FIND BOOKING BY ID

document.getElementById("lookupForm")
    .addEventListener("submit", async event => {
        event.preventDefault();

        const result = document.getElementById("lookupResult");
        clear(result);

        const id = document.getElementById("lookupId").value.trim();

        try {
            const booking = await apiRequest(
                `/bookings/${encodeURIComponent(id)}`
            );

            renderBooking(result, booking);

        } catch (error) {
            showError(result, error);
        }
    });


// BOOKING HISTORY AND PAGINATION

async function loadHistoryPage() {
    const result = document.getElementById("historyResult");

    clear(result);

    try {
        const params = new URLSearchParams({
            email: historyEmail,
            limit: String(historyLimit)
        });

        if (pageCursors[currentPage]) {
            params.set("cursor", pageCursors[currentPage]);
        }

        const data = await apiRequest(
            `/bookings?${params.toString()}`
        );

        if (!data.bookings.length) {
            result.appendChild(
                textNode("p", "No bookings found.")
            );
        }

        data.bookings.forEach(booking => {
            renderBooking(result, booking);
        });

        nextCursor = data.next_cursor;

        document.getElementById("previousPage").disabled =
            currentPage === 0;

        document.getElementById("nextPage").disabled =
            !nextCursor;

        document.getElementById("pageIndicator").textContent =
            `Page ${currentPage + 1}`;

    } catch (error) {
        showError(result, error);
    }
}

document.getElementById("historyForm")
    .addEventListener("submit", event => {
        event.preventDefault();

        historyEmail = document.getElementById(
            "historyEmail"
        ).value.trim();

        historyLimit = Number(
            document.getElementById("pageLimit").value
        );

        pageCursors = [null];
        currentPage = 0;
        nextCursor = null;

        loadHistoryPage();
    });

document.getElementById("nextPage")
    .addEventListener("click", () => {
        if (!nextCursor) return;

        pageCursors[currentPage + 1] = nextCursor;

        currentPage++;

        loadHistoryPage();
    });

document.getElementById("previousPage")
    .addEventListener("click", () => {
        if (!currentPage) return;

        currentPage--;

        loadHistoryPage();
    });


// CANCEL BOOKING

document.getElementById("cancelForm")
    .addEventListener("submit", async event => {
        event.preventDefault();

        const result = document.getElementById("cancelResult");
        clear(result);

        const id = document.getElementById(
            "cancelId"
        ).value.trim();

        if (!confirm(`Cancel booking ${id}?`)) {
            return;
        }

        try {
            const booking = await apiRequest(
                `/bookings/${encodeURIComponent(id)}`,
                {
                    method: "DELETE"
                }
            );

            result.appendChild(
                textNode(
                    "p",
                    "Booking cancelled successfully.",
                    "success-text"
                )
            );

            renderBooking(result, booking);

            await loadSlots();

            if (historyEmail) {
                await loadHistoryPage();
            }

        } catch (error) {
            showError(result, error);
        }
    });


// IDEMPOTENCY DEMONSTRATION

function newDemoKey() {
    document.getElementById("demoKey").value =
        crypto.randomUUID();

    lastDemoRequest = null;
}

document.getElementById("generateDemoKey")
    .addEventListener("click", newDemoKey);

newDemoKey();

document.getElementById("idempotencyForm")
    .addEventListener("submit", async event => {
        event.preventDefault();

        const result = document.getElementById(
            "idempotencyResult"
        );

        clear(result);

        const key = document.getElementById(
            "demoKey"
        ).value.trim();

        const payload = {
            slot_id: document.getElementById("demoSlot").value,
            name: document.getElementById("demoName").value.trim(),
            email: document.getElementById("demoEmail").value.trim()
        };

        const signature = JSON.stringify({
            key,
            payload
        });

        const isRetry = lastDemoRequest === signature;

        try {
            const booking = await apiRequest("/bookings", {
                method: "POST",
                headers: {
                    "Idempotency-Key": key
                },
                body: JSON.stringify(payload)
            });

            lastDemoRequest = signature;

            result.appendChild(
                textNode(
                    "p",
                    isRetry
                        ? "Retry returned the original booking."
                        : "Booking request succeeded.",
                    "success-text"
                )
            );

            renderBooking(result, booking);

            // Keep the booked slot selected for retrying.
            const previousSlot = payload.slot_id;

            await loadSlots();

            const demoSlot = document.getElementById("demoSlot");

            const slotStillListed = [
                ...demoSlot.options
            ].some(option => option.value === previousSlot);

            if (!slotStillListed) {
                demoSlot.appendChild(
                    new Option(
                        `${previousSlot} — booked (retry only)`,
                        previousSlot
                    )
                );
            }

            demoSlot.value = previousSlot;

        } catch (error) {
            showError(result, error);
        }
    });


// ADMIN RESET

document.getElementById("resetDemo")
    .addEventListener("click", async () => {
        const result = document.getElementById("resetResult");

        clear(result);

        const confirmed = confirm(
            "WARNING: This permanently deletes ALL bookings " +
            "and slots in the connected database. Continue?"
        );

        if (!confirmed) return;

        const confirmationText = prompt(
            "Type RESET to confirm deleting all existing booking data:"
        );

        if (confirmationText !== "RESET") {
            result.appendChild(
                textNode("p", "Reset cancelled.")
            );
            return;
        }

        // Generate future appointment slots.
        const day = new Date();

        day.setUTCDate(day.getUTCDate() + 30);
        day.setUTCHours(0, 0, 0, 0);

        const slots = [
            {
                id: "demo-001",
                provider: "Dr Ade",
                hour: 9
            },
            {
                id: "demo-002",
                provider: "Dr Sarah",
                hour: 10
            },
            {
                id: "demo-003",
                provider: "Dr James",
                hour: 11
            }
        ].map(({ id, provider, hour }) => {
            const start = new Date(day);

            start.setUTCHours(hour);

            const end = new Date(
                start.getTime() + 30 * 60 * 1000
            );

            return {
                id,
                provider,
                start: start.toISOString(),
                end: end.toISOString()
            };
        });

        try {
            const response = await apiRequest("/reset", {
                method: "POST",
                body: JSON.stringify({
                    slots
                })
            });

            result.appendChild(
                textNode(
                    "p",
                    `Reset complete. Created ${response.slots} test slots.`,
                    "success-text"
                )
            );

            lastDemoRequest = null;

            document.getElementById(
                "lookupResult"
            ).replaceChildren();

            document.getElementById(
                "historyResult"
            ).replaceChildren();

            document.getElementById(
                "cancelResult"
            ).replaceChildren();

            await loadSlots();

        } catch (error) {
            showError(result, error);
        }
    });