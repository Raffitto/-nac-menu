import baseline from "../catalogue/guest-menu-baseline-khobar.json";
import { buildOrderingCatalogue, filterOrderingCatalogue, orderingIdentity } from "./catalogueAdapter";
import { createRestaurant } from "./model";

test("ordering identity ignores a shared Foodics SKU", () => {
  const dish = { id: "dish-1", name_en: "Halloumi", price: "42 SAR", sku: "sk-1" };
  const ingredient = { id: "ing-1", name_en: "Halloumi", price: "42 SAR", sku: "sk-1", kind: "ingredient" };
  expect(orderingIdentity(dish).itemId).toBe("dish-1");
  expect(orderingIdentity(dish).catalogueKey).toBe("dish-1");
  const catalogue = buildOrderingCatalogue({
    items: [dish, ingredient, { id: "dish-2", name_en: "Halloumi portion", price: "20 SAR", sku: "sk-1", cloned_from_id: null }],
  }, { branchId: "khobar" });
  expect(catalogue.lines.map((line) => line.itemId)).toEqual(["dish-1", "dish-2"]);
  expect(catalogue.lines.every((line) => line.foodicsSku == null)).toBe(true);
  expect(catalogue.writes).toBe(0);
  expect(catalogue.guestChanged).toBe(false);
});

test("Khobar availability stays independent from Riyadh and Hettin stays closed", () => {
  const snapshot = {
    items: [
      { id: "olives", name_en: "Olives", price: "16 SAR", branch_id: "khobar", active: true, sold_out: true, placement_group_id: "olives-group" },
    ],
  };
  const khobar = buildOrderingCatalogue(snapshot, { branchId: "khobar" });
  const riyadh = buildOrderingCatalogue(snapshot, {
    branchId: "riyadh",
    availability: [{ branchId: "riyadh", catalogueKey: "olives-group", available: true }],
  });
  expect(khobar.lines[0]).toMatchObject({ available: false, unavailableReason: "sold_out", catalogueKey: "olives-group" });
  expect(riyadh.lines[0]).toMatchObject({ available: true, branchId: "riyadh", price: 16 });
  expect(buildOrderingCatalogue(snapshot, { branchId: "hettin" }).reason).toBe("hettin_guest_hidden");
  const jeddah = buildOrderingCatalogue(snapshot, { branchId: "jeddah" });
  expect(jeddah.lines[0].available).toBe(false);
  expect(jeddah.lines[0].unavailableReason).toBe("availability_not_recorded");
});

test("the canonical Khobar menu keeps portions apart and does not map Watermelon to a Foodics product", () => {
  const catalogue = buildOrderingCatalogue(baseline, { branchId: "khobar" });
  const watermelon = catalogue.lines.filter((line) => line.name === "Watermelon & Cucumber");
  const kale = catalogue.lines.filter((line) => line.name === "Kale & Cabbage").map((line) => line.price).sort((a, b) => a - b);
  expect(watermelon).toHaveLength(1);
  expect(watermelon[0]).toMatchObject({ price: 59, calories: 341, foodicsSku: null, available: true });
  expect(JSON.stringify(watermelon[0])).not.toContain("sk-1926");
  expect(kale).toEqual([45, 59]);
  const chicken = catalogue.lines.find((line) => line.modifiers.some((modifier) => modifier.name === "Add Chicken"));
  expect(chicken.modifiers.find((modifier) => modifier.name === "Add Chicken").price).toBe(25);
  expect(filterOrderingCatalogue(catalogue.lines, { query: "بطيخ", availableOnly: true }).length).toBeGreaterThan(0);
  expect(catalogue.guestChanged).toBe(false);
});

test("a waiter can order an available catalogue line with a modifier and a note", () => {
  const catalogue = buildOrderingCatalogue({
    items: [{ id: "toast", section_id: "s", name_en: "French Toast", name_ar: "فرنش توست", price: "59 SAR", calories: "462", branch_id: "khobar", active: true, vegetarian: true }],
    addOns: [{ id: "honey", name_en: "Extra honey", price: "4 SAR", active: true }],
    itemAddons: [{ item_id: "toast", addon_id: "honey", sort_order: 0 }],
    allergens: [{ id: "g", name_en: "Gluten" }],
    itemAllergens: [{ item_id: "toast", allergen_id: "g" }],
    sections: [{ id: "s", category_id: "c", name_en: "Bakery" }],
    categories: [{ id: "c", name_en: "Breakfast" }],
  }, { branchId: "khobar" });
  const line = catalogue.lines[0];
  const restaurant = createRestaurant({
    branchId: "khobar",
    menu: catalogue.lines.map((row) => ({ id: row.itemId, name: row.name, price: row.price, modifiers: row.modifiers, available: row.available })),
  });
  const booked = restaurant.reserve({ guestName: "Layla" });
  restaurant.assignTable(booked.reservation.id, "khobar:12");
  const opened = restaurant.openSession("khobar:12");
  const ordered = restaurant.addItem(opened.session.id, { itemId: line.itemId, modifierIds: ["honey"], instructions: "Cut in half" });
  expect(line).toMatchObject({ calories: 462, allergens: ["Gluten"], categoryName: "Breakfast", vegetarian: true });
  expect(ordered.item).toMatchObject({ price: 63, instructions: "Cut in half" });
  expect(ordered.writes).toBe(0);
  const unavailable = createRestaurant({
    branchId: "khobar",
    menu: [{ id: "toast", name: "French Toast", price: 59, modifiers: [], available: false }],
  });
  const again = unavailable.reserve({ guestName: "Nora" });
  unavailable.assignTable(again.reservation.id, "khobar:12");
  const session = unavailable.openSession("khobar:12");
  expect(unavailable.addItem(session.session.id, { itemId: "toast" }).reason).toBe("item_unavailable");
});
