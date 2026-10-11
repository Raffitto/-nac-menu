import { classifyRecipeEdges, foodicsSkuForProductId, recoveredLinksForIngredient } from "./foodicsRecipeRecovery";
import { pageCommerceSales } from "./recipeConsumptionApi";

describe("recovered Foodics recipe relationships", () => {
  test("the sold French Toast id is sk-0647, not the wastage sku", () => {
    const identity = foodicsSkuForProductId("97355136-ee5a-4553-9cc6-d460a294bc88");
    expect(identity.sku).toBe("sk-0647");
    expect(identity.verification).toBe("UNVERIFIED");
    expect(identity.sku).not.toBe("sk-1461");
  });

  test("a blank quantity is incomplete and a conflicting sub-recipe is not expanded", () => {
    const toast = classifyRecipeEdges("sk-0647");
    expect(toast.usable.map((edge) => edge.childName)).toContain("Raspberry Fruit");
    expect(toast.incomplete.map((edge) => edge.childName)).toContain("Honey Regular");
    expect(toast.conflicts.map((edge) => edge.childSku)).toContain("sk-0628");
    expect(toast.usable.map((edge) => edge.childSku)).not.toContain("sk-0628");
  });

  test("a full page that never ends is not treated as a complete period", async () => {
    const full = Array.from({ length: 1000 }, (_, index) => ({ source_order_item_id: String(index), status: "completed", quantity: 1, business_date: "2026-10-10", item_name: "Item", canonical_menu_item_id: null, branch_id: "khobar" }));
    const supabase = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          gte() { return this; },
          lte() { return this; },
          order() { return this; },
          range() { return Promise.resolve({ data: full, error: null }); },
        };
      },
    };
    const result = await pageCommerceSales(supabase, "khobar", { start: "2026-10-10", end: "2026-10-10" }, { pageSize: 1000, maxPages: 2 });
    expect(result.complete).toBe(false);
    // The stub repeats the same 1000 ids on every page; duplicates are now dropped and counted.
    expect(result.rawRowCount).toBe(2000);
    expect(result.rows.length).toBe(1000);
    expect(result.droppedRows.byReason.duplicate_row).toBe(1000);
  });

  test("recovered milk links are not invented for French Toast", () => {
    const links = recoveredLinksForIngredient([
      { foodics_product_id: "97355136-ee5a-4553-9cc6-d460a294bc88", quantity_sold: 15 },
    ], "milk");
    expect(links).toEqual([]);
  });
});
