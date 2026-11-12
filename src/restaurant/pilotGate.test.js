import { readRestaurantPilot } from "./pilotGate";

test("a missing restaurant API keeps the pilot, ordering, and payments off", async () => {
  const flags = await readRestaurantPilot(() => { throw new Error("offline"); });
  expect(flags).toEqual({ restaurantPilot: false, guestOrdering: false, guestPayments: false });
});

test("the pilot flag does not turn guest ordering or payments on", async () => {
  const flags = await readRestaurantPilot(async () => ({
    json: async () => ({ restaurantPilot: true, guestOrdering: false, guestPayments: false }),
  }));
  expect(flags.restaurantPilot).toBe(true);
  expect(flags.guestOrdering).toBe(false);
  expect(flags.guestPayments).toBe(false);
});
