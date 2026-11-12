/**
 * Simulated restaurant service. Local memory only.
 * A dining session owns one order and one primary bill.
 * The pass ticket is ticket:{orderId}. Station tickets are children of that order.
 * Nothing here writes Foodics, real payments, guest notifications, or the guest menu.
 */
import { layoutForBranch } from "./layouts/branchLayouts";
import { canTransitionReservation, isSimulatedTender, orderLine, reservationSlot } from "./platformContract";

export const SIMULATED_MENU = Object.freeze([
  { id: "olives", name: "Olives", price: 16, modifiers: [] },
  { id: "toast", name: "French Toast", price: 59, modifiers: [{ id: "honey", name: "Extra honey", price: 4 }] },
]);

export const TABLE_TRANSITIONS = Object.freeze({
  open: ["assigned", "occupied", "combined"],
  assigned: ["occupied", "open"],
  occupied: ["open"],
  combined: ["open"],
});

export const TICKET_TRANSITIONS = Object.freeze({
  queued: ["preparing"],
  preparing: ["ready"],
  ready: ["served"],
  served: [],
});

function deny(reason) {
  return { ok: false, reason, writes: 0 };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function defaultLayout(branchId) {
  return layoutForBranch(branchId);
}

function presentTable(seat, branchId) {
  const minSeats = Number.isInteger(seat.minSeats) ? seat.minSeats : null;
  const maxSeats = Number.isInteger(seat.maxSeats) ? seat.maxSeats : null;
  const verified = minSeats != null && maxSeats != null && minSeats >= 1 && maxSeats >= minSeats;
  return {
    ...seat,
    branchId,
    status: "open",
    sessionId: null,
    active: seat.active !== false,
    removed: false,
    minSeats: verified ? minSeats : null,
    maxSeats: verified ? maxSeats : null,
    seats: verified ? maxSeats : null,
    capacity: verified ? "verified" : "unverified",
    combinedWith: null,
  };
}

export function serviceStorageKey(branchId) {
  return `nac-restaurant-sim:v1:${branchId}`;
}

export function createRestaurant({ branchId = "khobar", layout, snapshot, menu = SIMULATED_MENU } = {}) {
  const chosen = layout || defaultLayout(branchId);
  const fresh = {
    branchId,
    revision: 0,
    floors: chosen.floors.map((floor) => ({ ...floor, branchId })),
    tables: chosen.tables.map((seat) => presentTable(seat, branchId)),
    guests: [],
    reservations: [],
    sessions: [],
    orders: [],
    tickets: [],
    bills: [],
    payments: [],
    visits: [],
    audit: [],
  };
  const state = snapshot ? clone(snapshot) : fresh;
  let seq = snapshot?.seq || 1;
  const id = (prefix) => `${prefix}-${seq++}`;
  const commit = () => { state.revision += 1; };
  const guard = (expectedRevision) => (
    expectedRevision != null && expectedRevision !== state.revision ? deny("service_conflict") : null
  );
  const audit = (action, entityId) => {
    state.audit.push({ id: id("audit"), action, entityId, branchId: state.branchId, at: state.audit.length + 1 });
  };
  const table = (tableId) => state.tables.find((row) => row.id === tableId && row.branchId === state.branchId);

  const restaurant = {
    state,
    menu,
    snapshot() {
      return { seq, state: clone(state) };
    },
    reserve({ guestName, partySize = 2, time = "19:30", date = null, phone = null } = {}, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      if (!String(guestName || "").trim()) return deny("guest_name_required");
      const slot = reservationSlot({ date, time });
      if (!slot.ok) return slot;
      const guest = { id: id("guest"), branchId: state.branchId, name: String(guestName).trim() };
      const recordedPhone = String(phone || "").trim();
      if (recordedPhone) guest.phone = recordedPhone;
      const reservation = {
        id: id("reservation"),
        branchId: state.branchId,
        guestId: guest.id,
        partySize,
        date: slot.date,
        time: slot.time,
        status: "booked",
        tableId: null,
      };
      state.guests.push(guest);
      state.reservations.push(reservation);
      audit("reservation_created", reservation.id);
      commit();
      return { ok: true, guest, reservation, revision: state.revision, writes: 0 };
    },
    assignTable(reservationId, tableId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const reservation = state.reservations.find((row) => row.id === reservationId);
      const seat = table(tableId);
      if (!reservation || reservation.branchId !== state.branchId) return deny("reservation_not_found");
      if (!canTransitionReservation(reservation.status, "seated")) return deny("reservation_not_booked");
      if (!seat || seat.active === false || seat.removed) return deny("table_inactive");
      if (!TABLE_TRANSITIONS[seat.status]?.includes("assigned")) return deny("table_unavailable");
      reservation.tableId = seat.id;
      reservation.status = "seated";
      seat.status = "assigned";
      audit("table_assigned", seat.id);
      commit();
      return { ok: true, reservation, table: seat, revision: state.revision, writes: 0 };
    },
    openSession(tableId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const seat = table(tableId);
      const reservation = state.reservations.find((row) => row.tableId === tableId && row.status === "seated");
      if (!seat || seat.active === false || seat.removed || !reservation) return deny("table_not_assigned");
      if (!TABLE_TRANSITIONS[seat.status]?.includes("occupied")) return deny("session_already_open");
      const session = {
        id: id("session"),
        branchId: state.branchId,
        floorId: seat.floorId,
        tableId: seat.id,
        reservationId: reservation.id,
        guestId: reservation.guestId,
        status: "open",
      };
      const order = { id: id("order"), sessionId: session.id, branchId: state.branchId, items: [], status: "open" };
      const ticket = { id: `ticket:${order.id}`, orderId: order.id, sessionId: session.id, station: "pass", status: "queued" };
      state.sessions.push(session);
      state.orders.push(order);
      state.tickets.push(ticket);
      seat.sessionId = session.id;
      seat.status = "occupied";
      audit("session_opened", session.id);
      commit();
      return { ok: true, session, order, ticket, revision: state.revision, writes: 0 };
    },
    addItem(sessionId, input = {}, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const line = orderLine(input);
      if (!line.ok) return line;
      const { itemId, modifierIds, instructions, quantity } = line.line;
      const session = state.sessions.find((row) => row.id === sessionId && row.status === "open" && row.branchId === state.branchId);
      const product = menu.find((row) => row.id === itemId);
      const order = state.orders.find((row) => row.sessionId === sessionId);
      const ticket = state.tickets.find((row) => row.orderId === order?.id && (row.station || "pass") === "pass");
      if (!session || !order || !ticket || !product) return deny("item_not_available");
      if (product.available === false) return deny("item_unavailable");
      if (ticket.status === "served") return deny("ticket_closed");
      const modifiers = modifierIds.map((modifierId) => product.modifiers.find((row) => row.id === modifierId)).filter(Boolean);
      if (modifiers.length !== modifierIds.length) return deny("modifier_not_available");
      const unit = product.price + modifiers.reduce((sum, row) => sum + row.price, 0);
      const item = {
        id: id("line"),
        orderId: order.id,
        itemId: product.id,
        name: product.name,
        quantity,
        modifiers,
        instructions,
        price: unit * quantity,
        station: "pass",
        status: "ordered",
      };
      order.items.push(item);
      if (ticket.status !== "queued") ticket.status = "queued";
      audit("item_ordered", item.id);
      commit();
      return { ok: true, item, ticket, revision: state.revision, writes: 0 };
    },
    setKitchenStatus(orderId, status, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const ticket = state.tickets.find((row) => row.orderId === orderId);
      const order = state.orders.find((row) => row.id === orderId && row.branchId === state.branchId);
      if (!ticket || !order) return deny("ticket_not_found");
      if (!TICKET_TRANSITIONS[ticket.status]?.includes(status)) return deny("kitchen_status_invalid");
      ticket.status = status;
      order.items.forEach((item) => {
        if (item.status === "ordered" || item.status === "preparing") item.status = status;
      });
      audit(`kitchen_${status}`, ticket.id);
      commit();
      return { ok: true, ticket, revision: state.revision, writes: 0 };
    },
    markServed(orderId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const order = state.orders.find((row) => row.id === orderId && row.branchId === state.branchId);
      const ticket = state.tickets.find((row) => row.orderId === orderId);
      if (!order || !TICKET_TRANSITIONS[ticket?.status]?.includes("served")) return deny("ticket_not_ready");
      order.items.forEach((item) => { item.status = "served"; });
      ticket.status = "served";
      audit("items_served", order.id);
      commit();
      return { ok: true, order, revision: state.revision, writes: 0 };
    },
    openBill(sessionId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const session = state.sessions.find((row) => row.id === sessionId && row.branchId === state.branchId);
      const order = state.orders.find((row) => row.sessionId === sessionId);
      if (!session || !order?.items.length) return deny("nothing_to_bill");
      if (order.items.some((item) => item.status !== "served")) return deny("items_not_served");
      if (state.bills.some((row) => row.sessionId === sessionId)) return deny("bill_already_open");
      const bill = {
        id: `bill:${sessionId}`,
        sessionId,
        branchId: state.branchId,
        total: order.items.reduce((sum, item) => sum + item.price, 0),
        status: "open",
      };
      state.bills.push(bill);
      audit("bill_opened", bill.id);
      commit();
      return { ok: true, bill, revision: state.revision, writes: 0 };
    },
    pay(sessionId, { amount, method = "simulated", tender = null, recordedAt = null, clientPaymentId = null } = {}, expectedRevision) {
      if (method !== "simulated") return deny("real_payments_disabled");
      if (!isSimulatedTender(tender)) return deny("tender_not_simulated");
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const bill = state.bills.find((row) => row.sessionId === sessionId && row.branchId === state.branchId && row.status !== "paid");
      const value = Number(amount);
      if (!bill || !Number.isFinite(value) || value <= 0) return deny("payment_invalid");
      if (clientPaymentId) {
        const existing = state.payments.find((row) => row.clientPaymentId === clientPaymentId && row.billId === bill.id);
        if (existing) return { ok: true, payment: existing, bill, alreadyRecorded: true, revision: state.revision, writes: 0 };
      }
      const paid = state.payments.filter((row) => row.billId === bill.id && row.status !== "refunded").reduce((sum, row) => sum + row.amount, 0);
      if (paid + value > bill.total) return deny("payment_exceeds_bill");
      const stamp = recordedAt || new Date().toISOString();
      if (Number.isNaN(new Date(stamp).getTime())) return deny("payment_time_invalid");
      const payment = {
        id: id("payment"),
        billId: bill.id,
        sessionId,
        branchId: state.branchId,
        amount: value,
        method: "simulated",
        tender,
        recordedAt: stamp,
        clientPaymentId,
        status: "simulated",
      };
      state.payments.push(payment);
      if (paid + value === bill.total) bill.status = "paid";
      audit("payment_simulated", payment.id);
      commit();
      return { ok: true, payment, bill, revision: state.revision, writes: 0 };
    },
    closeTable(sessionId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const session = state.sessions.find((row) => row.id === sessionId && row.branchId === state.branchId);
      const bill = state.bills.find((row) => row.sessionId === sessionId);
      const seat = state.tables.find((row) => row.sessionId === sessionId);
      const held = state.tables.filter((row) => row.sessionId === sessionId || row.combinedWith === seat?.id);
      if (!session || bill?.status !== "paid" || !seat || !held.length) return deny("bill_unpaid");
      if (held.some((row) => !TABLE_TRANSITIONS[row.status]?.includes("open"))) return deny("table_not_occupied");
      const reservation = state.reservations.find((row) => row.id === session.reservationId);
      if (reservation && !canTransitionReservation(reservation.status, "completed")) return deny("reservation_not_seated");
      session.status = "closed";
      session.combinedTableIds = session.combinedTableIds || [];
      held.forEach((row) => {
        row.status = "open";
        row.sessionId = null;
        row.combinedWith = null;
      });
      if (reservation) {
        reservation.status = "completed";
        audit("reservation_completed", reservation.id);
      }
      const visit = {
        id: id("visit"),
        guestId: session.guestId,
        branchId: state.branchId,
        floorId: session.floorId,
        sessionId,
        reservationId: session.reservationId,
        covers: reservation?.partySize ?? null,
        total: bill.total,
      };
      state.visits.push(visit);
      audit("table_closed", seat.id);
      commit();
      return { ok: true, visit, revision: state.revision, writes: 0 };
    },
    markArrived(reservationId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const reservation = state.reservations.find((row) => row.id === reservationId && row.branchId === state.branchId);
      if (!reservation) return deny("reservation_not_found");
      if (!canTransitionReservation(reservation.status, "arrived")) return deny("reservation_not_booked");
      reservation.status = "arrived";
      audit("guest_arrived", reservation.id);
      commit();
      return { ok: true, reservation, revision: state.revision, writes: 0 };
    },
    cancelReservation(reservationId, expectedRevision) {
      return endReservation(reservationId, "cancelled", "reservation_cancelled", expectedRevision);
    },
    markNoShow(reservationId, expectedRevision) {
      return endReservation(reservationId, "no_show", "reservation_no_show", expectedRevision);
    },
    transferTable(sessionId, toTableId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const session = state.sessions.find((row) => row.id === sessionId && row.status === "open" && row.branchId === state.branchId);
      const from = table(session?.tableId);
      const destination = table(toTableId);
      if (!session || !from) return deny("session_not_open");
      if (state.tables.some((row) => row.combinedWith === from.id)) return deny("release_combination_first");
      if (!destination || destination.id === from.id) return deny("table_unchanged");
      if (destination.active === false || destination.removed) return deny("table_inactive");
      if (destination.status !== "open") return deny("table_unavailable");
      const reservation = state.reservations.find((row) => row.id === session.reservationId);
      from.status = "open";
      from.sessionId = null;
      destination.status = "occupied";
      destination.sessionId = session.id;
      session.tableId = destination.id;
      session.floorId = destination.floorId;
      if (reservation) reservation.tableId = destination.id;
      audit("table_transferred", destination.id);
      commit();
      return { ok: true, session, from, table: destination, revision: state.revision, writes: 0 };
    },
    combineTables(sessionId, tableIds = [], expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const session = state.sessions.find((row) => row.id === sessionId && row.status === "open" && row.branchId === state.branchId);
      const primary = table(session?.tableId);
      const extras = [...new Set(tableIds)].map((tableId) => table(tableId)).filter((row) => row && row.id !== primary?.id);
      if (!session || !primary || extras.length < 1) return deny("combine_needs_two_tables");
      if (extras.some((row) => row.floorId !== primary.floorId || row.status !== "open" || row.active === false || row.removed)) {
        return deny("combine_floor_mismatch");
      }
      extras.forEach((row) => {
        row.status = "combined";
        row.combinedWith = primary.id;
        row.sessionId = session.id;
      });
      session.combinedTableIds = [...new Set([...(session.combinedTableIds || []), ...extras.map((row) => row.id)])];
      audit("tables_combined", session.id);
      commit();
      return { ok: true, session, tables: [primary, ...extras], revision: state.revision, writes: 0 };
    },
    configureCapacity(tableId, { minSeats, maxSeats } = {}, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const seat = table(tableId);
      const min = Number(minSeats);
      const max = Number(maxSeats);
      if (!seat) return deny("table_not_found");
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) return deny("capacity_unverified");
      seat.minSeats = min;
      seat.maxSeats = max;
      seat.seats = max;
      seat.capacity = "verified";
      audit("capacity_configured", seat.id);
      commit();
      return { ok: true, table: seat, revision: state.revision, writes: 0 };
    },
    deactivateTable(tableId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const seat = table(tableId);
      if (!seat) return deny("table_not_found");
      if (!tableIsFree(seat)) return deny("table_in_service");
      seat.active = false;
      audit("table_deactivated", seat.id);
      commit();
      return { ok: true, table: seat, revision: state.revision, writes: 0 };
    },
    activateTable(tableId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const seat = table(tableId);
      if (!seat || seat.removed) return deny("table_removed");
      seat.active = true;
      audit("table_activated", seat.id);
      commit();
      return { ok: true, table: seat, revision: state.revision, writes: 0 };
    },
    removeTable(tableId, expectedRevision) {
      const conflict = guard(expectedRevision);
      if (conflict) return conflict;
      const seat = table(tableId);
      if (!seat) return deny("table_not_found");
      if (seat.active !== false) return deny("table_still_active");
      if (!tableIsFree(seat)) return deny("table_in_service");
      seat.removed = true;
      audit("table_removed", seat.id);
      commit();
      return { ok: true, table: seat, revision: state.revision, writes: 0 };
    },
  };

  function tableIsFree(seat) {
    if (seat.status !== "open" || seat.sessionId || seat.combinedWith) return false;
    return !state.reservations.some((row) => row.tableId === seat.id && (row.status === "seated" || row.status === "arrived"));
  }

  function endReservation(reservationId, status, action, expectedRevision) {
    const conflict = guard(expectedRevision);
    if (conflict) return conflict;
    const reservation = state.reservations.find((row) => row.id === reservationId && row.branchId === state.branchId);
    if (!reservation) return deny("reservation_not_found");
    if (!canTransitionReservation(reservation.status, status)) return deny("reservation_not_booked");
    reservation.status = status;
    reservation.tableId = null;
    audit(action, reservation.id);
    commit();
    return { ok: true, reservation, revision: state.revision, writes: 0 };
  }
  return restaurant;
}

export function saveServiceSnapshot(storage, restaurant) {
  storage.setItem(serviceStorageKey(restaurant.state.branchId), JSON.stringify(restaurant.snapshot()));
  return { ok: true, revision: restaurant.state.revision, writes: 0 };
}

export function loadServiceSnapshot(storage, branchId, { menu } = {}) {
  const raw = storage.getItem(serviceStorageKey(branchId));
  const options = { branchId };
  if (Array.isArray(menu)) options.menu = menu;
  if (!raw) return { ok: true, restaurant: createRestaurant(options), writes: 0 };
  const parsed = JSON.parse(raw);
  if (parsed?.state?.branchId !== branchId) return { ok: false, reason: "branch_mismatch", writes: 0 };
  return { ok: true, restaurant: createRestaurant({ ...options, snapshot: { ...parsed.state, seq: parsed.seq } }), writes: 0 };
}
