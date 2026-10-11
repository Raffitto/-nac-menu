import { ASK_NAC_INTENTS, routeAskNacIntent } from "./intentRouter";
import { resolveFollowUpQuestion } from "./conversation/resolveFollowUpQuestion";
import {
  formatConsumptionAnswer,
  saleCountsAsSold,
  scaleStoredRecipeQuantity,
  summarizeIngredientConsumption,
} from "../../inventory/intelligence/consumptionEvidence";

describe("living recipe questions", () => {
  test("routes milk consumption and leaves wastage on its own intent", () => {
    const milk = routeAskNacIntent("How much milk should Khobar have consumed yesterday?");
    expect(milk.intent).toBe(ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION);
    const waste = routeAskNacIntent("What was our recorded wastage last week?");
    expect(waste.intent).not.toBe(ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION);
  });

  test("keeps the ingredient when the period changes", () => {
    const follow = resolveFollowUpQuestion("What about last week?", {
      lastQuestion: "How much milk should Khobar have consumed yesterday?",
      lastResolvedQuestion: "How much milk should Khobar have consumed yesterday?",
      lastIntent: ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION,
    });
    expect(follow.usedContext).toBe(true);
    expect(follow.resolvedQuestion.toLowerCase()).toMatch(/milk/);
    expect(follow.resolvedQuestion.toLowerCase()).toMatch(/last week/);
    expect(routeAskNacIntent(follow.resolvedQuestion).intent).toBe(ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION);
  });

  test("does not invent a quantity when sales do not cover the day", () => {
    const result = summarizeIngredientConsumption({
      ingredient: { name: "Whole milk" },
      ingredients: [{ name: "Whole milk" }],
      branchId: "khobar",
      window: { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" },
      sales: [],
      recipeLinks: [],
      latestSalesDate: "2026-08-31",
    });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.quantity).toBeNull();
    expect(result.postsStock).toBe(false);
    expect(formatConsumptionAnswer(result)).toMatch(/published through 2026-08-31/);
    expect(formatConsumptionAnswer(result)).toMatch(/No stock was posted/);
  });

  test("does not apply a recipe version that starts after the sale date", () => {
    const result = summarizeIngredientConsumption({
      ingredient: { name: "Coconut Milk" },
      ingredients: [{ name: "Coconut Milk" }],
      branchId: "khobar",
      window: { start: "2026-08-15", end: "2026-08-15", label: "2026-08-15" },
      sales: [{
        raw_item_name: "King Prawn rendang",
        matched_menu_item_id: "menu-prawn",
        quantity_sold: 1,
        is_modifier: false,
        semantic_class: "menu_item",
      }],
      recipeLinks: [],
      source: "canonical_commerce",
    });
    expect(result.quantity).toBeNull();
    expect(result.coverage).toEqual({ eligibleSoldRows: 1, recipeLinkedRows: 0 });
    expect(result.postsStock).toBe(false);
  });

  test("scales a linked sale and ignores modifiers and non-positive quantities", () => {
    expect(saleCountsAsSold({ quantity_sold: -1, is_modifier: false, semantic_class: "menu_item" })).toBe(false);
    expect(saleCountsAsSold({ quantity_sold: 2, is_modifier: true, semantic_class: "menu_item" })).toBe(false);
    const result = summarizeIngredientConsumption({
      ingredient: { name: "Whole milk" },
      ingredients: [{ name: "Whole milk" }],
      branchId: "khobar",
      window: { start: "2026-08-01", end: "2026-08-01", label: "2026-08-01" },
      sales: [
        { raw_item_name: "Latte", matched_menu_item_id: "menu-1", quantity_sold: 4, is_modifier: false, semantic_class: "drink" },
        { raw_item_name: "Extra shot", matched_menu_item_id: "menu-1", quantity_sold: 9, is_modifier: true, semantic_class: "modifier" },
      ],
      recipeLinks: [{ menuItemId: "menu-1", outputQuantity: "1", canonicalQuantity: "50", canonicalUnit: "gram" }],
    });
    expect(result.status).toBe("PROVISIONAL");
    expect(result.quantity).toBe(scaleStoredRecipeQuantity(4, 1, 50));
    expect(result.cost).toBeNull();
    expect(result.postsStock).toBe(false);
    expect(result.coverage).toEqual({ eligibleSoldRows: 1, recipeLinkedRows: 1 });
  });

  test("a Khobar-scoped account cannot read Riyadh", () => {
    const result = summarizeIngredientConsumption({
      accessDenied: true,
      branchId: "riyadh",
    });
    expect(result.reason).toMatch(/cannot read/);
  });
});
