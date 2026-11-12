import { orderingMenuForBranch } from "./RestaurantSim";
import { createRestaurant } from "./model";
import { performServiceAction } from "./contracts";
function sit(restaurant, tableId, guestName, line) {
  const booked = performServiceAction(restaurant, "host", "reserve", { guestName, partySize: 2 });
  performServiceAction(restaurant, "host", "assignTable", [booked.reservation.id, tableId]);
  const opened = performServiceAction(restaurant, "waiter", "openSession", tableId);
  const ordered = performServiceAction(restaurant, "waiter", "addItem", [opened.session.id, {
    itemId: line.id,
    modifierIds: line.modifiers[0] ? [line.modifiers[0].id] : [],
  }]);
  performServiceAction(restaurant, "kitchen", "setKitchenStatus", [opened.order.id, "preparing"]);
  performServiceAction(restaurant, "kitchen", "setKitchenStatus", [opened.order.id, "ready"]);
  performServiceAction(restaurant, "waiter", "markServed", opened.order.id);
  const bill = performServiceAction(restaurant, "cashier", "openBill", opened.session.id);
  performServiceAction(restaurant, "cashier", "pay", [opened.session.id, { amount: Math.min(10, bill.bill.total) }]);
  performServiceAction(restaurant, "cashier", "pay", [opened.session.id, { amount: bill.bill.total - Math.min(10, bill.bill.total) }]);
  const closed = performServiceAction(restaurant, "cashier", "closeTable", opened.session.id);
  return { booked, ordered, bill, closed };
}

test("the integrated service uses the canonical menu and does not post stock", () => {
  const menu = orderingMenuForBranch("khobar");
  const line = menu.find((row) => row.modifiers.length > 0) || menu[0];
  expect(line?.id).toBeTruthy();
  const restaurant = createRestaurant({ branchId: "khobar", menu });
  const first = sit(restaurant, "khobar:12", "Layla", line);
  const second = sit(restaurant, "khobar:50", "Omar", menu[0]);
  expect(first.ordered.item.itemId).toBe(line.id);
  expect(first.closed.visit.guestId).toBe(first.booked.guest.id);
  expect(second.closed.visit.floorId).toBe("outdoor");
  expect(first.closed.visit.total).toBeGreaterThan(0);
  expect(restaurant.state.orders).toHaveLength(2);
  expect(new Set(restaurant.state.tickets.map((ticket) => ticket.id)).size).toBe(2);
});
