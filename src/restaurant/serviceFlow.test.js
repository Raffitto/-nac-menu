import { createRestaurant, loadServiceSnapshot, saveServiceSnapshot } from "./model";
import { performServiceAction, openSimulatedService } from "./contracts";

function memory() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

function serve(restaurant, tableId, guestName) {
  const booked = performServiceAction(restaurant, "host", "reserve", { guestName });
  performServiceAction(restaurant, "host", "assignTable", [booked.reservation.id, tableId]);
  const opened = performServiceAction(restaurant, "waiter", "openSession", tableId);
  performServiceAction(restaurant, "waiter", "addItem", [opened.session.id, { itemId: "olives", modifierIds: [] }]);
  performServiceAction(restaurant, "kitchen", "setKitchenStatus", [opened.order.id, "preparing"]);
  performServiceAction(restaurant, "kitchen", "setKitchenStatus", [opened.order.id, "ready"]);
  performServiceAction(restaurant, "waiter", "markServed", opened.order.id);
  const bill = performServiceAction(restaurant, "cashier", "openBill", opened.session.id);
  performServiceAction(restaurant, "cashier", "pay", [opened.session.id, { amount: bill.bill.total }]);
  return performServiceAction(restaurant, "cashier", "closeTable", opened.session.id);
}

test("two floors can serve two tables without mixing orders or skipping kitchen steps", () => {
  const restaurant = createRestaurant({ branchId: "khobar" });
  expect(restaurant.state.floors.map((floor) => floor.id)).toEqual(["outdoor", "waiting", "indoor", "bar", "kitchen"]);
  const terrace = serve(restaurant, "khobar:50", "Maha");
  const dining = serve(restaurant, "khobar:14", "Omar");
  expect(terrace.visit.floorId).toBe("outdoor");
  expect(dining.visit.floorId).toBe("indoor");
  expect(restaurant.state.orders).toHaveLength(2);
  expect(new Set(restaurant.state.orders.map((order) => order.sessionId)).size).toBe(2);
  expect(restaurant.setKitchenStatus(restaurant.state.orders[0].id, "ready").reason).toBe("kitchen_status_invalid");
  expect(restaurant.state.tables.every((seat) => seat.status === "open")).toBe(true);
});

test("a stale revision cannot overwrite another session", () => {
  const restaurant = createRestaurant({ branchId: "riyadh" });
  const first = restaurant.reserve({ guestName: "Hana" });
  const stale = restaurant.reserve({ guestName: "Second" }, first.revision - 1);
  expect(stale.reason).toBe("service_conflict");
  expect(restaurant.state.reservations).toHaveLength(1);
});

test("development storage reloads one branch and refuses another branch snapshot", () => {
  const storage = memory();
  const restaurant = openSimulatedService("jeddah").restaurant;
  restaurant.reserve({ guestName: "Lina" });
  saveServiceSnapshot(storage, restaurant);
  const loaded = loadServiceSnapshot(storage, "jeddah");
  expect(loaded.restaurant.state.guests[0].name).toBe("Lina");
  expect(loaded.restaurant.state.revision).toBe(restaurant.state.revision);
  storage.setItem("nac-restaurant-sim:v1:khobar", storage.getItem("nac-restaurant-sim:v1:jeddah").replace("jeddah", "khobar"));
  const swapped = JSON.parse(storage.getItem("nac-restaurant-sim:v1:khobar"));
  swapped.state.branchId = "jeddah";
  storage.setItem("nac-restaurant-sim:v1:khobar", JSON.stringify(swapped));
  expect(loadServiceSnapshot(storage, "khobar").reason).toBe("branch_mismatch");
});
