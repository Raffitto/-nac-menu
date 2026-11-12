import { performServiceAction } from "../contracts";
import { createRestaurant } from "../model";
import {
  checkTotal,
  discountAttempt,
  MISSING_CONTRACT_ACTIONS,
  openTableOrder,
  placeTables,
  resolveStation,
  seatCaption,
  sendStagedItems,
  sendToStation,
} from "./posActions";

const menu = [
  { id: "toast", name: "French Toast", price: 59, modifiers: [{ id: "honey", name: "Extra honey", price: 4 }], available: true },
];

test("start order seats one walk-in and does not open a second session", () => {
  const restaurant = createRestaurant({ branchId: "khobar", menu });
  const first = openTableOrder(restaurant, {
    tableId: "khobar:12",
    partySize: 2,
    guestName: "Rana",
    now: new Date("2026-11-08T10:00:00"),
  });
  expect(first.ok).toBe(true);
  expect(first.created).toBe(true);
  expect(restaurant.state.sessions).toHaveLength(1);
  expect(restaurant.state.reservations[0]).toMatchObject({ partySize: 2, status: "seated" });
  expect(restaurant.state.guests[0].name).toBe("Rana");
  const second = openTableOrder(restaurant, { tableId: "khobar:12", partySize: 4, guestName: "Other" });
  expect(second.created).toBe(false);
  expect(second.session.id).toBe(first.session.id);
  expect(second.order.id).toBe(first.order.id);
  expect(second.ticket.id).toBe(first.ticket.id);
  expect(restaurant.state.sessions).toHaveLength(1);
  expect(restaurant.state.reservations).toHaveLength(1);
});

test("an assigned table opens the existing seat", () => {
  const restaurant = createRestaurant({ branchId: "khobar", menu });
  const booked = performServiceAction(restaurant, "host", "reserve", [{ guestName: "Layla", partySize: 3, time: "19:30" }, 0]);
  performServiceAction(restaurant, "host", "assignTable", [booked.reservation.id, "khobar:12", restaurant.state.revision]);
  const opened = openTableOrder(restaurant, { tableId: "khobar:12", partySize: 9, guestName: "Walk-in" });
  expect(opened.ok).toBe(true);
  expect(opened.created).toBe(true);
  expect(restaurant.state.guests.map((row) => row.name)).toEqual(["Layla"]);
  expect(restaurant.state.reservations[0].partySize).toBe(3);
  expect(restaurant.state.sessions).toHaveLength(1);
});

test("sending keeps the ticket and does not post a discount or a tax", () => {
  const restaurant = createRestaurant({ branchId: "khobar", menu });
  const opened = openTableOrder(restaurant, {
    tableId: "khobar:12",
    partySize: 2,
    guestName: "Rana",
    now: new Date("2026-11-08T10:00:00"),
  });
  const sent = sendStagedItems(restaurant, opened.session.id, [{
    itemId: "toast",
    quantity: 1,
    modifiers: [{ id: "honey", name: "Extra honey", price: 4 }],
    instructions: "Cut in half",
    course: "Table",
    price: 63,
  }]);
  expect(sent.ok).toBe(true);
  expect(sent.sameTicket).toBe(true);
  expect(sent.ticket.id).toBe(opened.ticket.id);
  expect(sent.order.id).toBe(opened.order.id);
  expect(sent.sent[0].item).toMatchObject({ itemId: "toast", price: 63, instructions: "Cut in half", quantity: 1 });
  expect(checkTotal(restaurant.state.orders[0].items, [])).toBe(63);
  expect(restaurant.state.bills).toHaveLength(0);
  expect(restaurant.state.orders[0].items[0].price).toBe(63);
  const revision = restaurant.state.revision;
  const discount = discountAttempt(restaurant);
  expect(discount.applied).toBe(false);
  expect(discount.unchanged).toBe(true);
  expect(restaurant.state.revision).toBe(revision);
});

test("kitchen and bar stay on one ticket and drinks are not posted", () => {
  const mixed = [
    { id: "toast", name: "French Toast", price: 59, modifiers: [{ id: "honey", name: "Extra honey", price: 4 }], available: true },
    { id: "eggs", name: "Shakshuka", price: 49, modifiers: [{ id: "pita", name: "Pita Bread", price: 6 }], available: true },
    { id: "juice", name: "Orange Juice", price: 22, modifiers: [], available: true },
    { id: "tea", name: "Breakfast Tea", price: 18, modifiers: [], available: true },
  ];
  const restaurant = createRestaurant({ branchId: "khobar", menu: mixed });
  const opened = openTableOrder(restaurant, {
    tableId: "khobar:12",
    partySize: 2,
    guestName: "Rana",
    now: new Date("2026-11-08T10:00:00"),
  });
  const lines = [
    { localId: "a", itemId: "toast", quantity: 1, modifiers: [{ id: "honey" }], instructions: "Cut in half", categorySlug: "breakfast", price: 63 },
    { localId: "b", itemId: "eggs", quantity: 1, modifiers: [{ id: "pita" }], instructions: "", categorySlug: "daytime", price: 55 },
    { localId: "c", itemId: "juice", quantity: 1, modifiers: [], instructions: "", categorySlug: "drinks", price: 22 },
    { localId: "d", itemId: "tea", quantity: 2, modifiers: [], instructions: "", categorySlug: "drinks", price: 36 },
  ];
  const kitchen = sendToStation(restaurant, opened.session.id, lines, "kitchen");
  expect(kitchen.ok).toBe(true);
  expect(kitchen.openedTicket).toBe(false);
  expect(kitchen.ticket.id).toBe(opened.ticket.id);
  expect(kitchen.sent.map((row) => row.item.itemId)).toEqual(["toast", "eggs"]);
  expect(kitchen.sent[0].item).toMatchObject({ instructions: "Cut in half", price: 63, station: "pass" });
  expect(kitchen.sent[1].item.price).toBe(55);
  expect(restaurant.state.tickets).toHaveLength(1);
  expect(restaurant.state.orders[0].items).toHaveLength(2);

  const drinksOnKitchen = sendToStation(restaurant, opened.session.id, lines.filter((line) => line.categorySlug === "drinks"), "kitchen");
  expect(drinksOnKitchen.ok).toBe(false);
  expect(restaurant.state.orders[0].items).toHaveLength(2);

  const bar = sendToStation(restaurant, opened.session.id, lines.filter((line) => line.categorySlug === "drinks"), "bar");
  expect(bar).toMatchObject({ ok: false, applied: false, reason: "bar_route_not_posted", tickets: 1, writes: 0 });
  expect(bar.held.map((line) => line.itemId)).toEqual(["juice", "tea"]);
  expect(restaurant.state.tickets.map((row) => row.id)).toEqual([opened.ticket.id]);
  expect(restaurant.state.orders[0].items).toHaveLength(2);

  const repeat = sendToStation(restaurant, opened.session.id, [], "kitchen");
  expect(repeat.reason).toBe("nothing_to_send");
  expect(restaurant.state.orders[0].items).toHaveLength(2);
});

test("a recorded product station overrides the category", () => {
  expect(resolveStation({ categorySlug: "drinks" })).toMatchObject({ station: "bar", source: "category" });
  expect(resolveStation({ categorySlug: "drinks", station: "pass" })).toMatchObject({ station: "pass", source: "product" });
  expect(resolveStation({ categorySlug: "daytime" }).station).toBe("pass");
  expect(resolveStation({ name: "Special" })).toMatchObject({ station: null, reason: "station_not_recorded" });
});

test("a zero guest count is refused before a session exists", () => {
  const restaurant = createRestaurant({ branchId: "khobar", menu });
  const refused = openTableOrder(restaurant, { tableId: "khobar:12", partySize: 0, guestName: "Rana" });
  expect(refused).toMatchObject({ ok: false, reason: "party_size_invalid", writes: 0 });
  expect(restaurant.state.sessions).toHaveLength(0);
  expect(restaurant.state.reservations).toHaveLength(0);
});

test("indoor tables stay in separate cards", () => {
  const restaurant = createRestaurant({ branchId: "khobar", menu });
  const indoor = restaurant.state.tables.filter((row) => row.floorId === "indoor");
  const placed = placeTables(indoor);
  expect(placed).toHaveLength(indoor.length);
  const width = 1100;
  const height = 620;
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const dx = Math.abs(placed[i].left - placed[j].left) / 100 * width;
      const dy = Math.abs(placed[i].top - placed[j].top) / 100 * height;
      expect(dx < 100 && dy < 74).toBe(false);
    }
  }
});

test("Khobar capacity stays unverified until a manager records it", () => {
  const restaurant = createRestaurant({ branchId: "khobar", menu });
  expect(seatCaption(restaurant.state.tables.find((row) => row.id === "khobar:12"))).toBe("Seats unverified");
  expect(MISSING_CONTRACT_ACTIONS.map((row) => row.id)).toEqual(
    expect.arrayContaining(["print", "voidItem", "correctItem", "discount", "tags", "course", "tax"]),
  );
});
