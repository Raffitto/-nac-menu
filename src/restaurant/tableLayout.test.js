import { KHOBAR_TABLES } from "./layouts/khobarFloor";
import { serviceTableId } from "./layouts/branchLayouts";
import { createRestaurant } from "./model";
import { performServiceAction } from "./contracts";
import { PLATFORM_CONTRACT_VERSION } from "./platformContract";

function seat(restaurant, label, guestName) {
  const tableId = serviceTableId(restaurant.state.branchId, label);
  const booked = performServiceAction(restaurant, "host", "reserve", { guestName, partySize: 2 });
  performServiceAction(restaurant, "host", "assignTable", [booked.reservation.id, tableId]);
  return { booked, tableId };
}

test("Khobar service tables are the photographed floor and do not invent seats", () => {
  expect(PLATFORM_CONTRACT_VERSION).toBe(3);
  const restaurant = createRestaurant({ branchId: "khobar" });
  const labels = restaurant.state.tables.map((table) => table.label);
  expect(labels).toHaveLength(KHOBAR_TABLES.length);
  expect(new Set(restaurant.state.tables.map((table) => table.id)).size).toBe(labels.length);
  expect(labels).toEqual(KHOBAR_TABLES.map((table) => table.label));
  expect(restaurant.state.tables.every((table) => table.capacity === "unverified" && table.seats == null && table.minSeats == null && table.maxSeats == null)).toBe(true);
  expect(restaurant.state.tables.find((table) => table.label === "12").id).toBe("khobar:12");
  const riyadh = createRestaurant({ branchId: "riyadh" });
  expect(riyadh.state.tables).toHaveLength(3);
  expect(riyadh.state.tables.some((table) => table.id.startsWith("khobar:"))).toBe(false);
});

test("arrival, cancellation, transfer, and combination stay on one session", () => {
  const restaurant = createRestaurant({ branchId: "khobar" });
  const first = seat(restaurant, "12", "Layla");
  const arrived = performServiceAction(restaurant, "host", "reserve", { guestName: "Nora", partySize: 4 });
  expect(performServiceAction(restaurant, "host", "markArrived", arrived.reservation.id).reservation.status).toBe("arrived");
  expect(performServiceAction(restaurant, "waiter", "cancelReservation", arrived.reservation.id).reason).toBe("role_forbidden");
  expect(performServiceAction(restaurant, "host", "cancelReservation", arrived.reservation.id).reservation.status).toBe("cancelled");
  const noShow = performServiceAction(restaurant, "host", "reserve", { guestName: "Sami" });
  expect(performServiceAction(restaurant, "host", "markNoShow", noShow.reservation.id).reservation.status).toBe("no_show");

  const opened = performServiceAction(restaurant, "waiter", "openSession", first.tableId);
  const moved = performServiceAction(restaurant, "host", "transferTable", [opened.session.id, "khobar:14"]);
  expect(moved.session.tableId).toBe("khobar:14");
  expect(restaurant.state.sessions).toHaveLength(1);
  expect(restaurant.state.orders).toHaveLength(1);
  expect(restaurant.state.tables.find((table) => table.id === "khobar:12").status).toBe("open");

  const combined = performServiceAction(restaurant, "host", "combineTables", [opened.session.id, ["khobar:16"]]);
  expect(combined.session.combinedTableIds).toEqual(["khobar:16"]);
  expect(restaurant.state.orders).toHaveLength(1);
  expect(restaurant.state.bills).toHaveLength(0);
  expect(performServiceAction(restaurant, "host", "transferTable", [opened.session.id, "khobar:18"]).reason).toBe("release_combination_first");

  const second = seat(restaurant, "50", "Omar");
  const other = performServiceAction(restaurant, "waiter", "openSession", second.tableId);
  expect(other.session.id).not.toBe(opened.session.id);
  expect(restaurant.state.sessions.filter((row) => row.status === "open")).toHaveLength(2);
});

test("occupied and active tables cannot be deactivated or removed", () => {
  const restaurant = createRestaurant({ branchId: "khobar" });
  const seated = seat(restaurant, "22", "Hana");
  expect(performServiceAction(restaurant, "host", "deactivateTable", seated.tableId).reason).toBe("table_in_service");
  expect(performServiceAction(restaurant, "host", "removeTable", seated.tableId).reason).toBe("table_still_active");
  const opened = performServiceAction(restaurant, "waiter", "openSession", seated.tableId);
  expect(performServiceAction(restaurant, "host", "deactivateTable", seated.tableId).reason).toBe("table_in_service");
  performServiceAction(restaurant, "waiter", "addItem", [opened.session.id, { itemId: "olives" }]);
  performServiceAction(restaurant, "kitchen", "setKitchenStatus", [opened.order.id, "preparing"]);
  performServiceAction(restaurant, "kitchen", "setKitchenStatus", [opened.order.id, "ready"]);
  performServiceAction(restaurant, "waiter", "markServed", opened.order.id);
  const bill = performServiceAction(restaurant, "cashier", "openBill", opened.session.id);
  performServiceAction(restaurant, "cashier", "pay", [opened.session.id, { amount: bill.bill.total, tender: "cash" }]);
  performServiceAction(restaurant, "cashier", "closeTable", opened.session.id);
  expect(restaurant.state.tables.find((table) => table.id === seated.tableId).status).toBe("open");
  expect(performServiceAction(restaurant, "host", "configureCapacity", [seated.tableId, { minSeats: 2 }]).reason).toBe("capacity_unverified");
  const configured = performServiceAction(restaurant, "host", "configureCapacity", [seated.tableId, { minSeats: 2, maxSeats: 4 }]);
  expect(configured.table).toMatchObject({ minSeats: 2, maxSeats: 4, seats: 4, capacity: "verified" });
  expect(performServiceAction(restaurant, "host", "deactivateTable", "khobar:59").table.active).toBe(false);
  expect(performServiceAction(restaurant, "host", "assignTable", [
    performServiceAction(restaurant, "host", "reserve", { guestName: "Lina" }).reservation.id,
    "khobar:59",
  ]).reason).toBe("table_inactive");
  expect(performServiceAction(restaurant, "host", "removeTable", "khobar:59").table.removed).toBe(true);
  expect(restaurant.state.tables.some((table) => table.id === "khobar:59")).toBe(true);
});
