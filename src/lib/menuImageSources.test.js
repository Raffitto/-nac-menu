import { buildMenuSources } from "./menuImageSources";

test("responsive sources stay on the same photo and list widths", () => {
  const sources = buildMenuSources("/menu-icons/latte.jpg", {
    widths: [480, 960],
    formats: ["avif", "webp"],
  });
  expect(sources.fallback).toBe("/menu-icons/latte.jpg");
  expect(sources.avif).toBe("/menu-icons/latte-480.avif 480w, /menu-icons/latte-960.avif 960w");
  expect(sources.webp).toBe("/menu-icons/latte-480.webp 480w, /menu-icons/latte-960.webp 960w");
  expect(sources.expand).toBe("/menu-icons/latte-960.webp");
});

test("unknown photos keep the original file", () => {
  const sources = buildMenuSources("/menu-icons/missing.jpg", null);
  expect(sources.fallback).toBe("/menu-icons/missing.jpg");
  expect(sources.avif).toBeNull();
  expect(sources.expand).toBe("/menu-icons/missing.jpg");
});
