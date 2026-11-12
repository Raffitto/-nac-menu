import { createRestaurant, loadServiceSnapshot, saveServiceSnapshot } from "./model";
import { currentSeatedCovers } from "./platformContract";

test("a simulated service runs from reservation to visit history without external writes", () => {
  const restaurant = createRestaurant({ branchId: "khobar" });
  const booked = restaurant.reserve({ guestName: "Layla", partySize: 2 });
  const seated = restaurant.assignTable(booked.reservation.id, "khobar:12");
  const opened = restaurant.openSession("khobar:12");
  const ordered = restaurant.addItem(opened.session.id, { itemId: "toast", modifierIds: ["honey"] });
  const preparing = restaurant.setKitchenStatus(opened.order.id, "preparing");
  expect(preparing.ticket.status).toBe("preparing");
  const ready = restaurant.setKitchenStatus(opened.order.id, "ready");
  expect(ready.ticket.status).toBe("ready");
  const served = restaurant.markServed(opened.order.id);
  const bill = restaurant.openBill(opened.session.id);
  const first = restaurant.pay(opened.session.id, { amount: 30 });
  expect(first.bill.status).toBe("open");
  const second = restaurant.pay(opened.session.id, { amount: 33 });
  expect(second.bill.status).toBe("paid");
  const closed = restaurant.closeTable(opened.session.id);

  expect(booked.ok && seated.ok && opened.ok && ordered.ok).toBe(true);
  expect(served.order.items[0].status).toBe("served");
  expect(ordered.item.price).toBe(63);
  expect(bill.bill.total).toBe(63);
  expect(closed.visit).toMatchObject({ guestId: booked.guest.id, total: 63 });
  expect(restaurant.state.tables[0].status).toBe("open");
  expect(closed.reservation?.status || restaurant.state.reservations[0].status).toBe("completed");
  expect(restaurant.state.reservations.filter((row) => row.status === "seated")).toHaveLength(0);
  expect(restaurant.state.orders).toHaveLength(1);
  expect(restaurant.state.tickets[0].id).toBe(`ticket:${opened.order.id}`);
  expect(restaurant.state.bills[0].id).toBe(`bill:${opened.session.id}`);
  expect(restaurant.pay(opened.session.id, { amount: 1, method: "card" }).reason).toBe("real_payments_disabled");
  expect([booked, seated, opened, ordered, preparing, ready, served, bill, first, second, closed].every((step) => step.writes === 0)).toBe(true);
});

test("closing a paid session completes the reservation and drops its covers", () => {
  const restaurant = createRestaurant({ branchId: "khobar" });
  const booked = restaurant.reserve({ guestName: "Layla", partySize: 2, date: "2026-11-08" });
  restaurant.assignTable(booked.reservation.id, "khobar:12");
  const opened = restaurant.openSession("khobar:12");
  restaurant.addItem(opened.session.id, { itemId: "toast", modifierIds: ["honey"], quantity: 2 });
  expect(restaurant.state.orders[0].items[0].price).toBe(126);
  expect(restaurant.state.orders).toHaveLength(1);
  restaurant.setKitchenStatus(opened.order.id, "preparing");
  restaurant.setKitchenStatus(opened.order.id, "ready");
  restaurant.markServed(opened.order.id);
  const bill = restaurant.openBill(opened.session.id);
  const first = restaurant.pay(opened.session.id, {
    amount: 40,
    tender: "cash",
    recordedAt: "2026-11-08T06:10:00.000Z",
    clientPaymentId: "layla-cash",
  });
  const retry = restaurant.pay(opened.session.id, {
    amount: 40,
    tender: "cash",
    recordedAt: "2026-11-08T06:10:00.000Z",
    clientPaymentId: "layla-cash",
  });
  expect(retry.alreadyRecorded).toBe(true);
  expect(retry.payment.id).toBe(first.payment.id);
  expect(restaurant.state.payments).toHaveLength(1);
  restaurant.pay(opened.session.id, {
    amount: bill.bill.total - 40,
    tender: "card",
    recordedAt: "2026-11-08T06:11:00.000Z",
    clientPaymentId: "layla-card",
  });
  const closed = restaurant.closeTable(opened.session.id);
  expect(closed.visit.covers).toBe(2);
  expect(restaurant.state.reservations[0].status).toBe("completed");
  expect(currentSeatedCovers(restaurant.state)).toMatchObject({ parties: 0, covers: 0 });
  const storage = {
    map: new Map(),
    getItem(key) { return this.map.has(key) ? this.map.get(key) : null; },
    setItem(key, value) { this.map.set(key, String(value)); },
  };
  saveServiceSnapshot(storage, restaurant);
  const loaded = loadServiceSnapshot(storage, "khobar");
  expect(loaded.restaurant.state.payments).toHaveLength(2);
  expect(loaded.restaurant.state.payments[0].id).toBe(first.payment.id);
  expect(loaded.restaurant.state.payments[0]).toMatchObject({
    amount: 40,
    tender: "cash",
    method: "simulated",
    recordedAt: "2026-11-08T06:10:00.000Z",
    clientPaymentId: "layla-cash",
  });
  expect(loaded.restaurant.state.reservations[0].status).toBe("completed");
});

test("a second branch cannot seat this restaurant's reservation", () => {
  const khobar = createRestaurant({ branchId: "khobar" });
  const booked = khobar.reserve({ guestName: "Nora" });
  const other = createRestaurant({ branchId: "riyadh" });
  expect(other.assignTable(booked.reservation.id, "t1").reason).toBe("reservation_not_found");
  expect(khobar.state.tables[0].status).toBe("open");
});
