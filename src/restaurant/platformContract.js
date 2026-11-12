/**
 * Restaurant platform contract, version 2.
 * createRestaurant remains the only store. These rules describe later slices.
 * They do not open a second order, session, or primary bill, and they do not
 * write Foodics, real payments, printers, or guest notifications.
 */

export const PLATFORM_CONTRACT_VERSION = 3;

export const SIMULATED_TENDERS = Object.freeze(["cash", "card", "transfer"]);

export const KITCHEN_STATIONS = Object.freeze(["pass", "grill", "pastry", "bar"]);

export const RESERVATION_TRANSITIONS = Object.freeze({
  booked: ["arrived", "seated", "cancelled", "no_show"],
  arrived: ["seated", "cancelled", "no_show"],
  seated: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
});

export const FUTURE_ACTIONS = Object.freeze({
  host: [],
  waiter: ["correctItem", "voidItem"],
  kitchen: ["routeItem"],
  cashier: ["discount", "splitBill", "refund"],
});

export function canTransitionReservation(from, to) {
  return (RESERVATION_TRANSITIONS[from] || []).includes(to);
}

export function reservationSlot({ date = null, time } = {}) {
  if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return { ok: false, reason: "reservation_date_invalid", writes: 0 };
  }
  if (!/^\d{2}:\d{2}$/.test(String(time || ""))) {
    return { ok: false, reason: "reservation_time_invalid", writes: 0 };
  }
  return { ok: true, date, time, writes: 0 };
}

export function orderLine({ itemId, quantity = 1, modifierIds = [], instructions = "" } = {}) {
  const qty = Number(quantity);
  if (!itemId || !Number.isInteger(qty) || qty < 1 || qty > 99) {
    return { ok: false, reason: "quantity_invalid", writes: 0 };
  }
  return {
    ok: true,
    line: {
      itemId,
      quantity: qty,
      modifierIds: [...modifierIds],
      instructions: String(instructions || "").trim().slice(0, 140),
    },
    writes: 0,
  };
}

export function ticketIdFor(orderId, stationId = "pass") {
  if (!orderId) return null;
  if (!stationId || stationId === "pass") return `ticket:${orderId}`;
  if (!KITCHEN_STATIONS.includes(stationId)) return null;
  return `ticket:${orderId}:${stationId}`;
}

export function billIdFor(sessionId, partId = null) {
  if (!sessionId) return null;
  if (!partId) return `bill:${sessionId}`;
  return `bill:${sessionId}:${partId}`;
}

export function isSimulatedTender(tender) {
  return tender == null || SIMULATED_TENDERS.includes(tender);
}

export function currentSeatedCovers(state) {
  const rows = (state?.reservations || []).filter((row) => {
    if (row.status !== "seated" || !Number.isFinite(row.partySize)) return false;
    const seat = (state.tables || []).find((table) => table.id === row.tableId);
    return Boolean(seat && seat.status !== "open");
  });
  return {
    parties: rows.length,
    covers: rows.reduce((sum, row) => sum + row.partySize, 0),
    writes: 0,
  };
}

export function operationalStatus(state) {
  const reservations = state?.reservations || [];
  const sessions = state?.sessions || [];
  const visits = state?.visits || [];
  const occupied = (state?.tables || []).filter((row) => row.status === "occupied").map((row) => row.label);
  const open = sessions.filter((row) => row.status === "open").length;
  const seated = reservations.filter((row) => row.status === "seated").length;
  if (!reservations.length && !sessions.length && !visits.length) {
    return "Ready for the first reservation.";
  }
  const tables = occupied.length ? `Occupied tables: ${occupied.join(", ")}.` : "No table is occupied.";
  const visitLabel = `${visits.length} completed visit${visits.length === 1 ? "" : "s"}`;
  const sessionLabel = `${open} open session${open === 1 ? "" : "s"}`;
  const seatedLabel = `${seated} seated reservation${seated === 1 ? "" : "s"}`;
  return `Restored service: ${sessionLabel}, ${visitLabel}, ${seatedLabel}. ${tables} Nothing was written.`;
}

export function planTableTransfer({ fromTable, toTable, session } = {}) {
  if (!session || session.status !== "open") return { ok: false, reason: "session_not_open", writes: 0 };
  if (!fromTable || !toTable || fromTable.branchId !== toTable.branchId) {
    return { ok: false, reason: "branch_mismatch", writes: 0 };
  }
  if (fromTable.id === toTable.id) return { ok: false, reason: "table_unchanged", writes: 0 };
  if (toTable.status !== "open") return { ok: false, reason: "table_unavailable", writes: 0 };
  return {
    ok: true,
    writes: 0,
    applied: false,
    reason: "transfer_not_posted",
    move: { sessionId: session.id, fromTableId: fromTable.id, toTableId: toTable.id },
  };
}

export function planTableCombine({ tables = [], session } = {}) {
  if (!session || session.status !== "open") return { ok: false, reason: "session_not_open", writes: 0 };
  if (tables.length < 2) return { ok: false, reason: "combine_needs_two_tables", writes: 0 };
  const branchId = tables[0]?.branchId;
  if (tables.some((table) => table.branchId !== branchId || table.floorId !== tables[0].floorId)) {
    return { ok: false, reason: "combine_floor_mismatch", writes: 0 };
  }
  const capacities = tables.map((table) => (
    Number.isFinite(table.maxSeats) ? table.maxSeats : (Number.isFinite(table.seats) ? table.seats : null)
  ));
  const verified = capacities.every((value) => value != null);
  return {
    ok: true,
    writes: 0,
    applied: false,
    reason: "combine_not_posted",
    seats: verified ? capacities.reduce((sum, value) => sum + value, 0) : null,
    capacity: verified ? "verified" : "unverified",
    sessionId: session.id,
  };
}

export function planDiscount({ role, bill, amount = null, percent = null } = {}) {
  if (role !== "developer" && role !== "ceo") return { ok: false, reason: "role_forbidden", writes: 0 };
  if (!bill || bill.status === "paid") return { ok: false, reason: "discount_closed", writes: 0 };
  const value = amount == null ? null : Number(amount);
  const rate = percent == null ? null : Number(percent);
  if (value == null && rate == null) return { ok: false, reason: "discount_missing", writes: 0 };
  if (value != null && (!Number.isFinite(value) || value <= 0 || value > bill.total)) {
    return { ok: false, reason: "discount_invalid", writes: 0 };
  }
  if (rate != null && (!Number.isFinite(rate) || rate <= 0 || rate > 100)) {
    return { ok: false, reason: "discount_invalid", writes: 0 };
  }
  return {
    ok: true,
    writes: 0,
    applied: false,
    reason: "discount_not_posted",
    proposal: { billId: bill.id, amount: value, percent: rate },
  };
}

export function planRefund({ role, payment, amount } = {}) {
  if (!["cashier", "developer", "ceo"].includes(role)) return { ok: false, reason: "role_forbidden", writes: 0 };
  if (!payment || payment.method !== "simulated" || payment.status !== "simulated") {
    return { ok: false, reason: "real_payments_disabled", writes: 0 };
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0 || value > payment.amount) {
    return { ok: false, reason: "refund_invalid", writes: 0 };
  }
  return {
    ok: true,
    writes: 0,
    applied: false,
    reason: "refund_not_posted",
    proposal: { paymentId: payment.id, amount: value, method: "simulated" },
  };
}

export function guestHistory({ guest, visits = [], branchId, allBranches = false } = {}) {
  if (!guest) return { ok: false, reason: "guest_not_found", writes: 0 };
  const visible = (visits || []).filter((visit) => {
    if (visit.guestId !== guest.id) return false;
    return allBranches || visit.branchId === (branchId || guest.branchId);
  });
  return {
    ok: true,
    writes: 0,
    profile: {
      guestId: guest.id,
      branchId: guest.branchId,
      name: guest.name,
      visits: visible.length,
    },
  };
}

export function planQrOrderingSession({ branchId, tableId, sessionId } = {}) {
  return {
    ok: true,
    writes: 0,
    enabled: false,
    reason: "qr_ordering_not_activated",
    bindsTo: { branchId, tableId, sessionId: sessionId || null },
    createsOrder: false,
    notifiesGuest: false,
  };
}
