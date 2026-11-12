import {
  buildOrderMenu,
  dedupeTickets,
  discountExplanation,
  formatElapsed,
  paymentCall,
  serviceSlots,
  ticketDelay,
} from "./serviceShared";

test("queued and ready tickets are marked late only after their limit", () => {
  const since = 1000;
  expect(ticketDelay("queued", since, since + (5 * 60 * 1000)).delayed).toBe(false);
  expect(ticketDelay("queued", since, since + (5 * 60 * 1000) + 1).delayed).toBe(true);
  expect(ticketDelay("preparing", since, since + (10 * 60 * 1000) + 1).delayed).toBe(true);
  expect(ticketDelay("served", since, since + 999999).delayed).toBe(false);
  expect(ticketDelay("queued", null, since).delayed).toBe(false);
});

test("duplicate ticket ids collapse to one card", () => {
  const result = dedupeTickets([
    { id: "ticket:order-1" },
    { id: "ticket:order-1" },
    { id: "ticket:order-2" },
    { id: "" },
  ]);
  expect(result.tickets.map((ticket) => ticket.id)).toEqual(["ticket:order-1", "ticket:order-2"]);
  expect(result.duplicates).toBe(2);
});

test("the catalogue adapter hides incomplete lines and blocks items the service cannot sell", () => {
  const menu = buildOrderMenu([
    { itemId: "toast", name: "French Toast", price: "59 SAR", modifiers: [{ id: "honey", name: "Extra honey", price: "4 SAR" }] },
    { name: "Broken", price: 1 },
    { itemId: "water", name: "Water", price: 8, modifiers: [] },
    { itemId: "off", name: "Hidden", price: 5, available: false, modifiers: [] },
  ], [{ id: "toast", name: "French Toast", price: 59, modifiers: [] }]);
  expect(menu.rejected).toBe(1);
  expect(menu.unavailable).toBe(1);
  expect(menu.lines.map((line) => [line.itemId, line.orderable])).toEqual([
    ["toast", true],
    ["water", false],
  ]);
  expect(menu.lines[0].modifiers[0]).toMatchObject({ id: "honey", price: 4 });
});

test("simulated payments and discount permission stay on the shared contract", () => {
  expect(paymentCall("30")).toEqual({ amount: 30, method: "simulated", tender: null });
  expect(paymentCall("30", "cash")).toEqual({ amount: 30, method: "simulated", tender: "cash" });
  expect(discountExplanation("cashier").permitted).toBe(false);
  expect(discountExplanation("cashier").message).toMatch(/not permitted/i);
  expect(discountExplanation("ceo").permitted).toBe(true);
  expect(discountExplanation("ceo").message).toMatch(/no discount action/i);
  expect(formatElapsed(125000)).toBe("2:05");
  expect(serviceSlots()).toContain("19:30");
  expect(serviceSlots()).toContain("08:00");
});
