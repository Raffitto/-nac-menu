import { cardBreadcrumb, componentOpenTarget, popCardTarget, pushCardTarget } from "./foodBibleCardNav";

describe("foodBibleCardNav", () => {
  test("pushes components and pops back to the parent without closing", () => {
    const steak = { recipeId: "steak", displayName: "Black Angus Steak Au Poivre", kind: "menu_item" };
    const sauce = { id: "sauce", name: "PEPPERCORN SAUCE" };
    const nested = { id: "demi", name: "Demi glace base" };
    let stack = pushCardTarget([], steak);
    stack = pushCardTarget(stack, componentOpenTarget(steak, sauce));
    expect(cardBreadcrumb(stack)).toEqual(["Black Angus Steak Au Poivre", "PEPPERCORN SAUCE"]);
    stack = pushCardTarget(stack, componentOpenTarget(sauce, nested));
    expect(stack).toHaveLength(3);
    stack = popCardTarget(stack);
    expect(stack[stack.length - 1].displayName).toBe("PEPPERCORN SAUCE");
    stack = popCardTarget(stack);
    expect(stack[stack.length - 1].displayName).toBe("Black Angus Steak Au Poivre");
    expect(popCardTarget(stack)).toEqual([]);
  });

  test("does not inherit the parent photograph onto a component target", () => {
    const parent = { recipeId: "steak", displayName: "Steak", heroImagePath: "food-bible/recipes/steak.png" };
    const target = componentOpenTarget(parent, { id: "sauce", name: "PEPPERCORN SAUCE" });
    expect(target.heroImagePath).toBeUndefined();
    expect(target.kind).toBe("component");
  });
});
