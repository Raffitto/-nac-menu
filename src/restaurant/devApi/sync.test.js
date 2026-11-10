import { createRestaurantSync, restaurantSyncIntervalMs } from "./sync";

test("active kitchen and waiter screens poll every 4 seconds", () => {
  expect(restaurantSyncIntervalMs("waiter")).toBe(4000);
  expect(restaurantSyncIntervalMs("kitchen")).toBe(4000);
});

test("reception and cashier poll every 8 seconds", () => {
  expect(restaurantSyncIntervalMs("host")).toBe(8000);
  expect(restaurantSyncIntervalMs("cashier")).toBe(8000);
});

test("management polls every 20 seconds", () => {
  expect(restaurantSyncIntervalMs("manager")).toBe(20000);
});

test("a hidden screen does not poll and a visible refresh does", async () => {
  let calls = 0;
  const sync = createRestaurantSync({
    pull: async () => { calls += 1; },
    isHidden: () => true,
  });
  await sync.request(false);
  expect(calls).toBe(0);
  await sync.request(true);
  expect(calls).toBe(1);
});

test("a second refresh shares the request already in flight", async () => {
  let calls = 0;
  let release = () => {};
  const sync = createRestaurantSync({
    pull: () => {
      calls += 1;
      return new Promise((resolve) => { release = resolve; });
    },
    isHidden: () => false,
  });
  const first = sync.request(true);
  const second = sync.request(true);
  expect(calls).toBe(1);
  release();
  await first;
  await second;
  expect(calls).toBe(1);
});
