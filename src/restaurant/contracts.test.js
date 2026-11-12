import { catalogueLine, consumptionIntent, openSimulatedService, performServiceAction, serviceSummary } from "./contracts";

test("roles share one service identity and Hettin stays closed", () => {
  expect(openSimulatedService("hettin").reason).toBe("hettin_guest_hidden");
  const opened = openSimulatedService("khobar");
  const restaurant = opened.restaurant;
  const booked = performServiceAction(restaurant, "host", "reserve", { guestName: "Layla", partySize: 2 });
  expect(performServiceAction(restaurant, "waiter", "reserve", { guestName: "Other" }).reason).toBe("role_forbidden");
  performServiceAction(restaurant, "host", "assignTable", [booked.reservation.id, "khobar:12"]);
  const session = performServiceAction(restaurant, "waiter", "openSession", "khobar:12");
  const item = performServiceAction(restaurant, "waiter", "addItem", [session.session.id, { itemId: "toast", modifierIds: ["honey"] }]);
  expect(performServiceAction(restaurant, "cashier", "setKitchenStatus", [session.order.id, "preparing"]).reason).toBe("role_forbidden");
  performServiceAction(restaurant, "kitchen", "setKitchenStatus", [session.order.id, "preparing"]);
  performServiceAction(restaurant, "kitchen", "setKitchenStatus", [session.order.id, "ready"]);
  performServiceAction(restaurant, "waiter", "markServed", session.order.id);
  const bill = performServiceAction(restaurant, "cashier", "openBill", session.session.id);
  performServiceAction(restaurant, "cashier", "pay", [session.session.id, { amount: bill.bill.total }]);
  const closed = performServiceAction(restaurant, "cashier", "closeTable", session.session.id);
  expect(closed.visit.total).toBe(63);
  expect(restaurant.state.orders).toHaveLength(1);
  expect(consumptionIntent(item.item, "khobar")).toMatchObject({ postsStock: false, writes: 0 });
  expect(serviceSummary(restaurant.state)).toMatchObject({ openSessions: 0, paidBills: 1, visits: 1, writes: 0 });
});

test("a menu catalogue line must carry an item, a name, and a price", () => {
  expect(catalogueLine({ itemId: "toast", name: "French Toast", price: "59 SAR", modifiers: [{ id: "honey", name: "Extra honey", price: "4 SAR" }] }).line).toMatchObject({
    itemId: "toast",
    price: 59,
    modifiers: [{ id: "honey", price: 4 }],
  });
  expect(catalogueLine({ name: "Missing id", price: 10 }).reason).toBe("catalogue_line_incomplete");
});
