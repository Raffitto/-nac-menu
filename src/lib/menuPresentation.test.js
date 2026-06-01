import {
  CATEGORY_SELECTOR_ORDER,
  orderCategoriesForSelector,
} from "./menuPresentation";

describe("orderCategoriesForSelector", () => {
  const categories = [
    { id: "brunch", en: "Brunch" },
    { id: "daytime", en: "Daytime" },
    { id: "breakfast", en: "Breakfast" },
    { id: "evening", en: "Evening" },
    { id: "desserts", en: "Desserts" },
    { id: "drinks", en: "Drinks" },
  ];

  test("uses canonical selector order", () => {
    const ordered = orderCategoriesForSelector(categories);
    expect(ordered.map((c) => c.id)).toEqual(CATEGORY_SELECTOR_ORDER);
  });

  test("omits missing categories without shifting positions of others", () => {
    const partial = categories.filter((c) => c.id !== "brunch");
    const ordered = orderCategoriesForSelector(partial);
    expect(ordered.map((c) => c.id)).toEqual(
      CATEGORY_SELECTOR_ORDER.filter((id) => id !== "brunch"),
    );
  });
});
