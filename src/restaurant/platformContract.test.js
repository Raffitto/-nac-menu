import { createRestaurant } from "./model";
import { assertSingleServiceIdentity } from "./contracts";
import {
  billIdFor,
  canTransitionReservation,
  guestHistory,
  operationalStatus,
  orderLine,
  planDiscount,
  planQrOrderingSession,
  planRefund,
  planTableCombine,
  planTableTransfer,
  reservationSlot,
  ticketIdFor,
} from "./platformContract";

test("reservation, quantity, ticket, and bill identities stay on one session", () => {
  expect(canTransitionReservation("seated", "completed")).toBe(true);
  expect(canTransitionReservation("completed", "seated")).toBe(false);
  expect(reservationSlot({ date: "2026-11-08", time: "19:30" }).ok).toBe(true);
  expect(reservationSlot({ date: "tomorrow", time: "19:30" }).reason).toBe("reservation_date_invalid");
  expect(orderLine({ itemId: "toast", quantity: 2 }).line.quantity).toBe(2);
  expect(orderLine({ itemId: "toast", quantity: 0 }).reason).toBe("quantity_invalid");
  expect(ticketIdFor("order-1")).toBe("ticket:order-1");
  expect(ticketIdFor("order-1", "grill")).toBe("ticket:order-1:grill");
  expect(billIdFor("session-1")).toBe("bill:session-1");
  expect(billIdFor("session-1", "a")).toBe("bill:session-1:a");
});

test("a station ticket and a split part do not create a second order or primary bill", () => {
  const restaurant = createRestaurant({ branchId: "khobar" });
  const booked = restaurant.reserve({ guestName: "Layla" });
  restaurant.assignTable(booked.reservation.id, "khobar:12");
  const opened = restaurant.openSession("khobar:12");
  restaurant.state.tickets.push({
    id: ticketIdFor(opened.order.id, "grill"),
    orderId: opened.order.id,
    sessionId: opened.session.id,
    station: "grill",
    status: "queued",
  });
  restaurant.state.bills.push({
    id: billIdFor(opened.session.id),
    sessionId: opened.session.id,
    branchId: "khobar",
    total: 16,
    status: "open",
  });
  restaurant.state.bills.push({
    id: billIdFor(opened.session.id, "a"),
    sessionId: opened.session.id,
    partId: "a",
    branchId: "khobar",
    total: 8,
    status: "open",
  });
  expect(assertSingleServiceIdentity(restaurant.state).ok).toBe(true);
  restaurant.state.orders.push({ id: "order-extra", sessionId: opened.session.id, items: [] });
  expect(assertSingleServiceIdentity(restaurant.state).reason).toBe("duplicate_service_identity");
});

test("future transfer, discount, refund, and QR plans do not post", () => {
  const session = { id: "session-1", status: "open" };
  const fromTable = { id: "t1", branchId: "khobar", floorId: "main", status: "occupied", seats: 2 };
  const toTable = { id: "t2", branchId: "khobar", floorId: "main", status: "open", seats: 4 };
  expect(planTableTransfer({ fromTable, toTable, session })).toMatchObject({ applied: false, writes: 0, reason: "transfer_not_posted" });
  expect(planTableCombine({ tables: [fromTable, toTable], session })).toMatchObject({ applied: false, seats: 6, writes: 0 });
  expect(planDiscount({ role: "cashier", bill: { id: "bill:session-1", status: "open", total: 20 }, amount: 5 }).reason).toBe("role_forbidden");
  expect(planDiscount({ role: "ceo", bill: { id: "bill:session-1", status: "open", total: 20 }, percent: 10 })).toMatchObject({ applied: false, writes: 0 });
  const payment = { id: "payment-1", amount: 20, method: "simulated", status: "simulated" };
  expect(planRefund({ role: "cashier", payment, amount: 5 })).toMatchObject({ applied: false, writes: 0 });
  expect(planRefund({ role: "cashier", payment: { ...payment, method: "card" }, amount: 5 }).reason).toBe("real_payments_disabled");
  expect(planQrOrderingSession({ branchId: "khobar", tableId: "t1", sessionId: "session-1" })).toMatchObject({
    enabled: false,
    createsOrder: false,
    notifiesGuest: false,
    writes: 0,
  });
  expect(guestHistory({
    guest: { id: "guest-1", branchId: "khobar", name: "Layla" },
    visits: [{ guestId: "guest-1", branchId: "riyadh" }, { guestId: "guest-1", branchId: "khobar" }],
    branchId: "khobar",
  }).profile.visits).toBe(1);
  expect(operationalStatus({ reservations: [], sessions: [], visits: [], tables: [] })).toMatch(/ready for the first reservation/i);
});
