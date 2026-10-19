import { buildMenuSources } from "./menuImageSources";
import manifest from "./menuImageManifest.json";

test("cards use a same-size WebP and the expanded photo stays original", () => {
  const sources = buildMenuSources("/menu-icons/latte.jpg", {
    widths: [1400],
    formats: ["webp"],
  });
  expect(sources.fallback).toBe("/menu-icons/latte.jpg");
  expect(sources.avif).toBeNull();
  expect(sources.webp).toBe("/menu-icons/latte-1400.webp 1400w");
  expect(sources.card).toBe("/menu-icons/latte-1400.webp");
  expect(sources.expand).toBe("/menu-icons/latte.jpg");
});

test("the pastry basket card uses the optimized WebP and the modal keeps the same photo", () => {
  const sources = buildMenuSources("/pastries-basket.jpg", manifest.images["/pastries-basket.jpg"]);
  expect(sources.card).toBe("/pastries-basket-1024.webp");
  expect(sources.expand).toBe("/pastries-basket.jpg");
});

test("unknown photos keep the original file", () => {
  const sources = buildMenuSources("/menu-icons/missing.jpg", null);
  expect(sources.fallback).toBe("/menu-icons/missing.jpg");
  expect(sources.avif).toBeNull();
  expect(sources.expand).toBe("/menu-icons/missing.jpg");
});
