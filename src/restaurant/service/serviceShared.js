/**
 * Read models and screen-only helpers for the service floors.
 * Mutations stay in performServiceAction. Nothing here opens a second session,
 * order, ticket, or bill.
 */
import { canPerform, catalogueLine } from "../contracts";

export const BRANCHES = Object.freeze([
  { id: "khobar", label: "Khobar" },
  { id: "riyadh", label: "Riyadh" },
  { id: "jeddah", label: "Jeddah" },
]);

export const STATUS_LABEL = Object.freeze({
  open: "Open",
  assigned: "Assigned",
  occupied: "Occupied",
  booked: "Booked",
  arrived: "Arrived",
  seated: "Seated",
  combined: "Combined",
  queued: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  ordered: "Ordered",
  paid: "Paid",
  closed: "Closed",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
  cleaning: "Cleaning",
  blocked: "Blocked",
  closed_unpaid: "Closed unpaid",
});

export const KITCHEN_COLUMNS = Object.freeze([
  { id: "queued", label: "New", hint: "Queued tickets wait here." },
  { id: "accepted", label: "Accepted", hint: "The kitchen has accepted the ticket. No preparation time is assumed." },
  { id: "preparing", label: "Preparing", hint: "The pass is working these tickets." },
  { id: "ready", label: "Ready", hint: "Waiting for the waiter to run them." },
  { id: "served", label: "Completed", hint: "Served tickets land here. Completed is not a separate status." },
]);

export const DELAY_MS = Object.freeze({
  queued: 5 * 60 * 1000,
  preparing: 10 * 60 * 1000,
  ready: 3 * 60 * 1000,
});

export const SIMULATED_TENDERS = Object.freeze([
  { id: "cash", label: "Pay with cash", name: "Cash" },
  { id: "card", label: "Pay with card", name: "Card" },
  { id: "transfer", label: "Pay with transfer", name: "Transfer" },
]);

export const SEPARATE_BILL_MESSAGE = "Each session has one bill. Separate checks are not in the service contract. Take a partial payment to split the amount.";

export function emptyScreen() {
  return {
    waitlist: [],
    waitSeq: 1,
    notes: {},
    tenders: {},
    billRequests: {},
    clocks: {},
  };
}

export function reasonText(reason) {
  const text = String(reason || "unknown").replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function statusLabel(status) {
  return STATUS_LABEL[status] || "Status unavailable";
}

export function tableStatusLabel(status) {
  if (status === "open") return "Available";
  return statusLabel(status);
}

export function money(value) {
  if (!Number.isFinite(value)) return "Amount unavailable";
  return `${value} SAR`;
}

export function serviceSlots() {
  const slots = [];
  for (let minutes = 8 * 60; minutes <= 23 * 60 + 30; minutes += 30) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    slots.push(`${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
  }
  return slots;
}

export function formatServiceTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Time unavailable";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatElapsed(ms) {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const total = Math.floor(safe / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ticketDelay(status, since, now) {
  const limitMs = DELAY_MS[status] ?? null;
  if (!Number.isFinite(since) || !Number.isFinite(now)) {
    return { delayed: false, elapsedMs: 0, limitMs };
  }
  const elapsedMs = Math.max(0, now - since);
  return { delayed: Boolean(limitMs) && elapsedMs > limitMs, elapsedMs, limitMs };
}

export function guestName(state, guestId) {
  const guest = state.guests.find((row) => row.id === guestId);
  return guest?.name || "Guest name missing";
}

export function paidToward(payments, billId) {
  return (payments || []).filter((row) => row.billId === billId).reduce((sum, row) => sum + row.amount, 0);
}

export function dedupeTickets(tickets) {
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const ticket of tickets || []) {
    if (!ticket?.id || seen.has(ticket.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(ticket.id);
    unique.push(ticket);
  }
  return { tickets: unique, duplicates };
}

export function buildOrderMenu(externalRows, simulatedMenu) {
  const menu = simulatedMenu || [];
  const menuIds = new Set(menu.map((row) => row.id));
  const source = Array.isArray(externalRows) && externalRows.length
    ? externalRows
    : menu.map((row) => ({
      itemId: row.id,
      name: row.name,
      price: row.price,
      modifiers: row.modifiers || [],
      available: true,
    }));
  const lines = [];
  let rejected = 0;
  let unavailable = 0;
  for (const row of source) {
    const parsed = catalogueLine(row);
    if (!parsed.ok) {
      rejected += 1;
      continue;
    }
    if (parsed.line.available === false) {
      unavailable += 1;
      continue;
    }
    lines.push({
      ...parsed.line,
      orderable: menuIds.has(parsed.line.itemId),
    });
  }
  return { lines, rejected, unavailable };
}

export function paymentCall(amount, tender = null) {
  return { amount: Number(amount), method: "simulated", tender };
}

export function discountExplanation(role) {
  const permitted = canPerform(role, "discount");
  if (!permitted) {
    return {
      permitted: false,
      message: "This role is not permitted to discount, and the service contract has no discount action. The bill total is unchanged.",
    };
  }
  return {
    permitted: true,
    message: "Permission would allow this role through, but the service contract has no discount action. The bill total is unchanged.",
  };
}

export function reservationByTable(state, tableId) {
  return state.reservations.find((row) => row.tableId === tableId && row.status === "seated") || null;
}

export function openSessionForTable(state, tableId) {
  return state.sessions.find((row) => row.tableId === tableId && row.status === "open") || null;
}

export function orderForSession(state, sessionId) {
  return state.orders.find((row) => row.sessionId === sessionId) || null;
}

export function ticketForOrder(state, orderId) {
  return state.tickets.find((row) => row.orderId === orderId) || null;
}
