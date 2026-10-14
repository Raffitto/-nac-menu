import { buildMenuSources } from "./menuImageSources";

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

test("unknown photos keep the original file", () => {
  const sources = buildMenuSources("/menu-icons/missing.jpg", null);
  expect(sources.fallback).toBe("/menu-icons/missing.jpg");
  expect(sources.avif).toBeNull();
  expect(sources.expand).toBe("/menu-icons/missing.jpg");
});
