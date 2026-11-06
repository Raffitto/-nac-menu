import {
  canonicalPlacementKey,
  isActiveBigNac,
  isRetiredBigNac,
  isSameCanonicalPlacement,
  presentGuestMenuItem,
} from "./canonicalGuestCatalogue";
import { filterPublicMenuData } from "./menuVisibility";

test("every branch shows Khobar's Big NAC without replacing the stored row", () => {
  const khobar = { id: "kh", branch_id: "khobar", en: "Big NAC", calories: 1115, price: "69 SAR", active: true };
  const riyadh = { id: "ry", branch_id: "riyadh", en: "Big Nac", calories: 1100, price: "68", active: true };
  const quinoa = { en: "Quinoa", calories: 269, price: "45 SAR", active: true };

  expect(isActiveBigNac(khobar)).toBe(true);
  expect(isRetiredBigNac(riyadh)).toBe(true);
  expect(presentGuestMenuItem(khobar)).toBe(khobar);

  const menu = filterPublicMenuData({
    evening: [{ title: { en: "Mains" }, items: [riyadh, quinoa] }],
  });

  expect(menu.evening[0].items.map((item) => item.en)).toEqual(["Big NAC", "Quinoa"]);
  expect(menu.evening[0].items[0]).toMatchObject({
    id: "ry",
    branch_id: "riyadh",
    en: "Big NAC",
    price: "69 SAR",
    calories: 1115,
  });
});

test("a section that has the current Big NAC does not also show the 68 SAR product", () => {
  const menu = filterPublicMenuData({
    brunch: [{
      title: { en: "Plates" },
      items: [
        { id: "current", branch_id: "khobar", en: "Big NAC", calories: 1115, price: "69 SAR", active: true },
        { id: "obsolete", branch_id: "khobar", en: "Big NAC", calories: 1100, price: "68 SAR", active: true },
        { id: "kale-am", branch_id: "khobar", en: "Kale & Cabbage", price: "59 SAR", active: true },
        { id: "kale-pm", branch_id: "khobar", en: "Kale & Cabbage", price: "45 SAR", active: true },
      ],
    }],
  });

  expect(menu.brunch[0].items.map((item) => item.id)).toEqual(["current", "kale-am", "kale-pm"]);
  expect(menu.brunch[0].items[0]).toMatchObject({ en: "Big NAC", price: "69 SAR", calories: 1115 });
});

test("scheduled unavailability hides every same-price placement and expires", () => {
  const during = Date.parse("2026-10-24T12:00:00Z");
  const after = Date.parse("2026-10-24T19:00:00Z");
  const source = {
    brunch: [{
      title: { en: "Plates" },
      items: [
        { id: "toast-brunch", en: "Mushroom Toast", price: "59 SAR", active: true, hidden_until: "2026-10-24T18:00:00Z" },
        { id: "kale-am", en: "Kale & Cabbage", price: "59 SAR", active: true },
      ],
    }],
    evening: [{
      title: { en: "Mains" },
      items: [
        { id: "toast-evening", en: "Mushroom Toast", price: "59 SAR", active: true },
        { id: "kale-pm", en: "Kale & Cabbage", price: "45 SAR", active: true },
        { id: "old-toast", en: "Mushroom Toast", price: "59 SAR", active: false },
      ],
    }],
  };

  const hidden = filterPublicMenuData(source, during);
  expect(hidden.brunch[0].items.map((item) => item.id)).toEqual(["kale-am"]);
  expect(hidden.evening[0].items.map((item) => item.id)).toEqual(["kale-pm"]);

  const restored = filterPublicMenuData(source, after);
  expect(restored.brunch[0].items.map((item) => item.id)).toEqual(["toast-brunch", "kale-am"]);
  expect(restored.evening[0].items.map((item) => item.id)).toEqual(["toast-evening", "kale-pm"]);
});

test("an inactive historical row does not hide the live placement", () => {
  const menu = filterPublicMenuData({
    brunch: [{
      items: [{ id: "old", en: "Mushroom Toast", price: "59 SAR", active: false }],
    }],
    evening: [{
      items: [{ id: "live", en: "Mushroom Toast", price: "59 SAR", active: true }],
    }],
  });

  expect(menu.evening[0].items.map((item) => item.id)).toEqual(["live"]);
});

test("canonical identity keeps branches and portions apart", () => {
  const khobarLarge = { branch_id: "khobar", en: "Quinoa", price: "59 SAR" };
  const khobarSmall = { branch_id: "khobar", en: "Quinoa", price: "45 SAR" };
  const riyadhLarge = { branch_id: "riyadh", en: "Quinoa", price: "59 SAR" };

  expect(isSameCanonicalPlacement(khobarLarge, { ...khobarLarge, id: "other-menu" })).toBe(true);
  expect(isSameCanonicalPlacement(khobarLarge, khobarSmall)).toBe(false);
  expect(isSameCanonicalPlacement(khobarLarge, riyadhLarge)).toBe(false);
  expect(canonicalPlacementKey({ en: "2 Eggs Any Style (Copy)", price: "31 SAR", branch_id: "khobar" }))
    .not.toBe(canonicalPlacementKey({ en: "2 Eggs Any Style", price: "31 SAR", branch_id: "khobar" }));
});
