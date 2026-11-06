import { filterPublicMenuData } from "./menuVisibility";
import { resolveRootAppKind } from "./platformMode";
import { describeCatalogueEntity, resolveCatalogueIdentity } from "./catalogueIdentity";
import { buildCatalogueChangeImpact, propagationTargetIds } from "./catalogueChangeImpact";
import { scanCatalogueIntegrity } from "./catalogueIntegrity";
import { theoreticalPlateCost } from "./catalogueCost";

const frenchToast = {
  id: "placement-khobar-brunch",
  placement_group_id: "product-french-toast",
  branch_id: "khobar",
  section_id: "brunch",
  name_en: "French Toast",
  desc_en: "Brioche, caramelised banana, maple syrup",
  price: "45 SAR",
  calories: "612",
  active: true,
};

const frenchToastEvening = {
  ...frenchToast,
  id: "placement-khobar-evening",
  section_id: "evening",
  price: "45 SAR",
};

const brioche = {
  id: "ingredient-brioche",
  canonical_name: "Brioche",
  base_inventory_unit: "gram",
  active: true,
};

describe("unified catalogue identity", () => {
  test("French Toast placements share one product id and stay distinct from the recipe and ingredient", () => {
    expect(resolveCatalogueIdentity(frenchToast).catalogueId).toBe("product-french-toast");
    expect(resolveCatalogueIdentity(frenchToastEvening).catalogueId).toBe(resolveCatalogueIdentity(frenchToast).catalogueId);
    expect(describeCatalogueEntity({
      id: "recipe-french-toast",
      name: "French Toast",
      normalized_name: "french toast",
      menu_item_id: frenchToast.id,
    })).toBe("recipe");
    expect(describeCatalogueEntity({
      id: "recipe-version-3",
      recipe_id: "recipe-french-toast",
      version_number: 3,
      status: "active",
    })).toBe("recipe_version");
    expect(describeCatalogueEntity(brioche)).toBe("ingredient");
    expect(describeCatalogueEntity({
      id: "foodics-toast",
      foodics_name: "French Toast",
      normalized_key: "french toast",
      menu_item_id: frenchToast.id,
    })).toBe("foodics_product");
    expect(resolveCatalogueIdentity({ id: "orphan", name_en: "French Toast" }).catalogueId).toBeNull();
  });

  test("a description change lists loaded linked placements and does not publish or rewrite sales", () => {
    const sales = [{ matched_menu_item_id: frenchToast.id, net_sales: 120, period_start: "2026-10-01" }];
    const before = JSON.stringify(sales);
    const impact = buildCatalogueChangeImpact({
      placement: frenchToast,
      placements: [frenchToast, frenchToastEvening, { ...frenchToast, id: "riyadh", branch_id: "riyadh" }],
      recipes: [
        { id: "recipe-french-toast", name: "French Toast", menu_item_id: frenchToast.id, active: true },
        { id: "draft", name: "French Toast draft", menu_item_id: frenchToast.id, status: "draft", active: true },
      ],
      foodicsMappings: [{ id: "map-1", foodics_name: "French Toast", menu_item_id: frenchToast.id, match_confidence: 1 }],
      allergenIds: ["gluten", "dairy"],
      salesRows: sales,
      field: "desc_en",
    });
    expect(impact.publishes).toBe(false);
    expect(impact.lines.find((line) => line.id === "guest").value).toBe("3");
    expect(impact.lines.find((line) => line.id === "recipes").value).toBe("1");
    expect(impact.lines.find((line) => line.id === "drafts").value).toContain("1");
    expect(impact.lines.find((line) => line.id === "history").value).toContain("unchanged");
    expect(JSON.stringify(sales)).toBe(before);
    expect(propagationTargetIds(frenchToast, [frenchToast, frenchToastEvening], "active")).toEqual([
      frenchToast.id,
      frenchToastEvening.id,
    ]);
  });

  test("integrity quarantines ambiguous links and refuses an invalid conversion", () => {
    const report = scanCatalogueIntegrity({
      menuItems: [
        frenchToast,
        { ...frenchToastEvening, price: "39 SAR" },
        { id: "unlinked", name_en: "French Toast", price: "45 SAR", active: true, calories: "-" },
      ],
      recipes: [{ id: "gone", name: "Old toast", menu_item_id: "deleted-placement", active: true }],
      foodicsMappings: [
        { id: "map-a", normalized_key: "french-toast", foodics_name: "French Toast", menu_item_id: "deleted-placement", match_confidence: 0.4 },
        { id: "map-b", normalized_key: "french-toast", foodics_name: "French Toast copy", menu_item_id: frenchToast.id, match_confidence: 1 },
      ],
      conversions: [{ id: "bad", from_unit: "gram", to_unit: "millilitre", factor: 1 }],
    });
    expect(report.counts.CRITICAL).toBeGreaterThan(0);
    expect(report.findings.some((row) => row.code === "conflicting_shared_price")).toBe(true);
    expect(report.findings.some((row) => row.code === "unlinked_placement")).toBe(true);
    expect(report.findings.some((row) => row.code === "orphaned_recipe")).toBe(true);
    expect(report.findings.some((row) => row.code === "duplicate_foodics_mapping")).toBe(true);
    expect(report.findings.some((row) => row.code === "invalid_unit_conversion")).toBe(true);
    expect(report.repairs).toEqual([]);
  });

  test("theoretical cost stays incomplete when a cost or conversion is missing", () => {
    const missing = theoreticalPlateCost({
      lines: [{ id: "line-1", ingredient_id: brioche.id, quantity: 80, unit: "gram" }],
      ingredients: [brioche],
      costByIngredientId: {},
    });
    expect(missing.status).toBe("incomplete");
    expect(missing.amount).toBeNull();

    const ready = theoreticalPlateCost({
      lines: [{ id: "line-1", ingredient_id: brioche.id, quantity: 80, unit: "gram" }],
      ingredients: [brioche],
      costByIngredientId: { [brioche.id]: { last_purchase_price: 0.02 } },
    });
    expect(ready.status).toBe("complete");
    expect(ready.label).toBe("theoretical");
    expect(ready.amount).toBe(1.6);
  });

  test("the published guest presentation of French Toast is left unchanged and Hettin stays unavailable", () => {
    const menu = {
      brunch: [{
        title: { en: "Brunch" },
        items: [{ ...frenchToast, en: "French Toast", desc_en: frenchToast.desc_en }],
      }],
    };
    const visible = filterPublicMenuData(menu, Date.parse("2026-11-06T12:00:00Z"));
    const shown = visible.brunch[0].items[0];
    expect(shown.en).toBe("French Toast");
    expect(shown.price).toBe("45 SAR");
    expect(shown.calories).toBe("612");
    expect(shown.desc_en).toBe(frenchToast.desc_en);
    expect(resolveRootAppKind({ pathname: "/hettin" })).toBe("branch-unavailable");
  });
});
