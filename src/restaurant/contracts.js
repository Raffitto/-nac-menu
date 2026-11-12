/**
 * Shared service contracts. The only store is createRestaurant in model.js.
 * Other modules read these shapes. They do not create a second session, order, ticket, or bill.
 */
import { createRestaurant } from "./model";
import { billIdFor, operationalStatus, ticketIdFor } from "./platformContract";

export { operationalStatus };

export const SERVICE_BRANCHES = Object.freeze(["khobar", "riyadh", "jeddah"]);

export const ROLE_ACTIONS = Object.freeze({
  host: [
    "reserve",
    "assignTable",
    "markArrived",
    "cancelReservation",
    "markNoShow",
    "transferTable",
    "combineTables",
    "configureCapacity",
    "activateTable",
    "deactivateTable",
    "removeTable",
  ],
  waiter: ["openSession", "addItem", "markServed"],
  kitchen: ["setKitchenStatus"],
  cashier: ["openBill", "pay", "closeTable"],
});

export function assertServiceBranch(branchId) {
  if (branchId === "hettin") return { ok: false, reason: "hettin_guest_hidden", writes: 0 };
  if (!SERVICE_BRANCHES.includes(branchId)) return { ok: false, reason: "branch_not_in_service", writes: 0 };
  return { ok: true, branchId, writes: 0 };
}

export function canPerform(role, action) {
  if (role === "developer" || role === "ceo") return true;
  return (ROLE_ACTIONS[role] || []).includes(action);
}

export function catalogueLine(row) {
  const price = typeof row?.price === "number" ? row.price : Number(String(row?.price || "").replace(/[^\d.]/g, ""));
  const modifiers = (row?.modifiers || []).map((modifier) => ({
    id: modifier.id,
    name: modifier.name,
    price: typeof modifier.price === "number" ? modifier.price : Number(String(modifier.price || "").replace(/[^\d.]/g, "")),
  }));
  if (!row?.itemId || !row?.name || !Number.isFinite(price)) return { ok: false, reason: "catalogue_line_incomplete", writes: 0 };
  if (modifiers.some((modifier) => !modifier.id || !Number.isFinite(modifier.price))) {
    return { ok: false, reason: "modifier_incomplete", writes: 0 };
  }
  return { ok: true, line: { itemId: row.itemId, name: row.name, price, branchId: row.branchId || null, available: row.available !== false, modifiers }, writes: 0 };
}

export function consumptionIntent(orderItem, branchId) {
  return {
    sessionId: null,
    orderId: orderItem.orderId,
    itemId: orderItem.itemId,
    modifierIds: (orderItem.modifiers || []).map((modifier) => modifier.id),
    branchId,
    postsStock: false,
    reason: "simulated_service",
    writes: 0,
  };
}

export function serviceSummary(state) {
  return {
    branchId: state.branchId,
    openSessions: state.sessions.filter((row) => row.status === "open").length,
    paidBills: state.bills.filter((row) => row.status === "paid").length,
    visits: state.visits.length,
    writes: 0,
  };
}

function denyContract(reason) {
  return { ok: false, reason, writes: 0 };
}

export function assertSingleServiceIdentity(state) {
  const sessionIds = new Set(state.sessions.map((row) => row.id));
  const ordersBySession = new Map();
  for (const order of state.orders) {
    if (ordersBySession.has(order.sessionId)) return denyContract("duplicate_service_identity");
    ordersBySession.set(order.sessionId, order);
  }
  const ticketIds = new Set();
  for (const ticket of state.tickets) {
    if (!ticket.id || ticketIds.has(ticket.id)) return denyContract("duplicate_service_identity");
    ticketIds.add(ticket.id);
    const order = ordersBySession.get(ticket.sessionId);
    const expected = ticketIdFor(ticket.orderId, ticket.station || "pass");
    if (!order || order.id !== ticket.orderId || ticket.id !== expected) return denyContract("ticket_identity_drift");
  }
  const billIds = new Set();
  const primaryBills = new Set();
  for (const bill of state.bills) {
    if (!bill.id || billIds.has(bill.id) || !sessionIds.has(bill.sessionId)) return denyContract("bill_identity_drift");
    billIds.add(bill.id);
    if (!bill.partId) {
      if (bill.id !== billIdFor(bill.sessionId) || primaryBills.has(bill.sessionId)) return denyContract("bill_identity_drift");
      primaryBills.add(bill.sessionId);
    }
  }
  for (const bill of state.bills) {
    if (!bill.partId) continue;
    if (bill.id !== billIdFor(bill.sessionId, bill.partId) || !primaryBills.has(bill.sessionId)) {
      return denyContract("bill_identity_drift");
    }
  }
  const paymentIds = new Set();
  const clientIds = new Set();
  for (const payment of state.payments || []) {
    if (!payment.id || paymentIds.has(payment.id)) return denyContract("duplicate_service_identity");
    paymentIds.add(payment.id);
    if (payment.clientPaymentId) {
      if (clientIds.has(payment.clientPaymentId)) return denyContract("duplicate_service_identity");
      clientIds.add(payment.clientPaymentId);
    }
  }
  return { ok: true, writes: 0 };
}

export function performServiceAction(restaurant, role, action, payload) {
  const branch = assertServiceBranch(restaurant.state.branchId);
  if (!branch.ok) return branch;
  if (!canPerform(role, action)) return { ok: false, reason: "role_forbidden", writes: 0 };
  const method = restaurant[action];
  if (typeof method !== "function") return { ok: false, reason: "action_unknown", writes: 0 };
  return method.call(restaurant, ...(Array.isArray(payload) ? payload : [payload]));
}

export function openSimulatedService(branchId = "khobar", { menu } = {}) {
  const branch = assertServiceBranch(branchId);
  if (!branch.ok) return branch;
  const options = { branchId };
  if (Array.isArray(menu)) options.menu = menu;
  return { ok: true, restaurant: createRestaurant(options), writes: 0 };
}
