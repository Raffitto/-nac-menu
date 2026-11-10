import { resolveRestaurantApiBase } from "./endpoint";

test("a production bundle does not fall back to the localhost restaurant API", () => {
  expect(resolveRestaurantApiBase({})).toBe("");
});

test("hosted mode uses the site function and not a synthetic local server", () => {
  expect(resolveRestaurantApiBase({ hosted: "1" })).toBe("/api/restaurant");
});

test("local development can still address the localhost API", () => {
  expect(resolveRestaurantApiBase({ localBase: "http://127.0.0.1:4193" })).toBe("http://127.0.0.1:4193");
});
