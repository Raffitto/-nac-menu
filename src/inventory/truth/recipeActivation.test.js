import { CONVERSION_STATUS, GRAPH_STATUS } from "./contracts";
import { ACTIVATION_DECISION, RECIPE_VERSION_CLASS, SOURCE_EVIDENCE_CLASS } from "./readinessContracts";
import { buildRecipeGraph, expandRecipeToIngredients } from "./recipeGraph";
import { RECIPE_LINE_KIND, classifyRecipeLineKind } from "./recipeLineKind";
import {
  applyActivationPlan,
  mustForkNewDraft,
  planActivateRecipeVersion,
  validateRecipeVersionForActivation,
} from "./recipeActivation";

const gram = (id, name) => ({ id, canonical_name: name, active: true, base_inventory_unit: "gram" });

const catalog = {
  dishes: [
    {
      dish: "BLACK ANGUS, BLACK PEPPERCORN",
      pdf: "Black Angus, black peppercorn.pdf",
      lines: [
        { name: "Peppercorn sauce", qty: "75", unit: "gram" },
        { name: "Black Angus steak", qty: "150", unit: "gram" },
        { name: "Oil cooking", qty: "10", unit: "millilitre" },
        { name: "Table salt", qty: "3", unit: "gram" },
        { name: "Black pepper", qty: "10", unit: "gram" },
      ],
    },
    {
      dish: "SPECULOOS FRENCH TOAST, RASPBERRIES, CLOTTED CREAM",
      pdf: "Speculoos french toast.pdf",
      lines: [
        { name: "French toast batter bun", qty: "80", unit: "gram" },
        { name: "Clotted cream", qty: "50", unit: "gram" },
        { name: "Raspberries", qty: "40", unit: "gram" },
        { name: "Speculos", qty: "10", unit: "gram" },
        { name: "Honey", qty: "20", unit: "gram" },
        { name: "Butter", qty: "20", unit: "gram" },
      ],
    },
    {
      dish: "HOUSE SALAD WITH HAZELNUT SALT",
      pdf: "House salad.pdf",
      lines: [
        { name: "House salad dressing", qty: "20", unit: "gram" },
        { name: "Baby gem lettuce", qty: "1", unit: "each" },
      ],
    },
    {
      dish: "HONEY SWEET POTATO, BLACK PEPPER YOGURT, ZHOUGH",
      pdf: "Honey sweet potato.pdf",
      lines: [
        { name: "Sweet potatoes", qty: "170", unit: "gram" },
        { name: "Honey", qty: "20", unit: "gram" },
        { name: "Smoked maldon salt", qty: "2", unit: "gram" },
        { name: "Yoghurt", qty: "50", unit: "gram" },
        { name: "Zhoug", qty: "6", unit: "gram" },
      ],
    },
  ],
};

describe("activation transaction", () => {
  const versions = [
    { id: "v-old", recipe_id: "steak", status: "active", version_number: 1 },
    { id: "v-new", recipe_id: "steak", status: "draft", version_number: 2 },
  ];

  test("retires the previous active version and leaves exactly one active", () => {
    const plan = planActivateRecipeVersion({
      recipeId: "steak",
      activateVersionId: "v-new",
      versions,
    });
    expect(plan.executed).toBe(false);
    expect(plan.retireVersionIds).toEqual(["v-old"]);
    const next = applyActivationPlan(versions, plan);
    const actives = next.filter((version) => version.status === "active");
    expect(actives.map((version) => version.id)).toEqual(["v-new"]);
    expect(next.find((version) => version.id === "v-old").status).toBe("retired");
  });

  test("reverse writes restore the previous active version", () => {
    const plan = planActivateRecipeVersion({
      recipeId: "steak",
      activateVersionId: "v-new",
      versions,
    });
    const next = applyActivationPlan(versions, plan);
    const restored = applyActivationPlan(next, {
      recipeId: "steak",
      activateVersionId: "v-old",
      writes: plan.reverseWrites,
    });
    expect(restored.find((version) => version.id === "v-old").status).toBe("active");
    expect(restored.find((version) => version.id === "v-new").status).toBe("draft");
  });

  test("partial failure does not mutate the original version list", () => {
    const plan = planActivateRecipeVersion({
      recipeId: "steak",
      activateVersionId: "missing",
      versions,
    });
    expect(() => applyActivationPlan(versions, plan)).toThrow(/aborted/);
    expect(versions.find((version) => version.id === "v-old").status).toBe("active");
    expect(versions.find((version) => version.id === "v-new").status).toBe("draft");
  });

  test("future edits of an active version must fork a new draft", () => {
    expect(mustForkNewDraft("active")).toBe(true);
    expect(mustForkNewDraft("retired")).toBe(true);
    expect(mustForkNewDraft("draft")).toBe(false);
  });
});

describe("activation validation blockers", () => {
  test("circular sub-recipe is a graph blocker", () => {
    const graph = buildRecipeGraph({
      recipes: [
        { id: "a", name: "Loop A", recipe_type: "preparation", active: true, output_quantity: "1" },
        { id: "b", name: "Loop B", recipe_type: "preparation", active: true, output_quantity: "1" },
      ],
      versions: [
        { id: "va", recipe_id: "a", status: "active", version_number: 1 },
        { id: "vb", recipe_id: "b", status: "active", version_number: 1 },
      ],
      lines: [
        { id: "la", recipe_version_id: "va", sub_recipe_id: "b", quantity: "1", unit: "each" },
        { id: "lb", recipe_version_id: "vb", sub_recipe_id: "a", quantity: "1", unit: "each" },
      ],
      ingredients: [],
    });
    const expansion = expandRecipeToIngredients({ recipeId: "a", outputNeeded: "1", graph });
    expect(expansion.issues.some((issue) => issue.code === GRAPH_STATUS.CIRCULAR)).toBe(true);
  });

  test("invalid quantity blocks SAFE activation", () => {
    const result = validateRecipeVersionForActivation({
      recipe: {
        id: "a",
        name: "Broken qty",
        recipe_type: "preparation",
        active: true,
        output_quantity: "1",
      },
      versions: [{ id: "va", recipe_id: "a", status: "draft", version_number: 1 }],
      allRecipes: [{ id: "a", name: "Broken qty", recipe_type: "preparation", active: true, output_quantity: "1" }],
      lines: [{ id: "la", recipe_version_id: "va", ingredient_id: "salt", quantity: "0", unit: "gram" }],
      ingredients: [gram("salt", "table salt")],
      sourceCatalog: catalog,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === GRAPH_STATUS.INVALID_QUANTITY)).toBe(true);
  });
});

describe("documentation-line exclusion", () => {
  test("Total is documentation and does not enter the recipe graph", () => {
    expect(classifyRecipeLineKind({ ingredient_id: "total" }, { ingredientName: "Total" }))
      .toBe(RECIPE_LINE_KIND.DOCUMENTATION_LINE);
    const graph = buildRecipeGraph({
      recipes: [{ id: "toast", name: "Toast", recipe_type: "menu_item", active: true, output_quantity: "1", menu_item_id: "m" }],
      versions: [{ id: "v", recipe_id: "toast", status: "active", version_number: 1 }],
      lines: [
        { id: "bun", recipe_version_id: "v", ingredient_id: "bun", quantity: "80", unit: "gram" },
        { id: "total", recipe_version_id: "v", ingredient_id: "total", quantity: "220", unit: "gram" },
      ],
      ingredients: [gram("bun", "French toast batter bun"), gram("total", "Total")],
    });
    const expansion = expandRecipeToIngredients({ recipeId: "toast", outputNeeded: "1", graph });
    expect([...expansion.ingredients.keys()]).toEqual(["bun"]);
    expect(expansion.issues.filter((issue) => issue.lineId === "total")).toEqual([]);
  });
});

describe("Steak draft resolution", () => {
  test("v1 incomplete subset is superseded; v2 table-salt draft can be SAFE_TO_ACTIVATE", () => {
    const result = validateRecipeVersionForActivation({
      recipe: {
        id: "steak",
        name: "BLACK ANGUS, BLACK PEPPERCORN",
        recipe_type: "menu_item",
        menu_item_id: "menu-steak",
        active: true,
        output_quantity: "1",
        output_unit: "each",
      },
      versions: [
        { id: "steak-v1", recipe_id: "steak", status: "draft", version_number: 1 },
        { id: "steak-v2", recipe_id: "steak", status: "draft", version_number: 2 },
        { id: "sauce-v", recipe_id: "sauce", status: "active", version_number: 1 },
      ],
      allRecipes: [
        { id: "steak", name: "BLACK ANGUS, BLACK PEPPERCORN", recipe_type: "menu_item", menu_item_id: "menu-steak", active: true, output_quantity: "1", output_unit: "each" },
        { id: "sauce", name: "PEPPERCORN SAUCE", recipe_type: "preparation", active: true, output_quantity: "4000", output_unit: "gram" },
      ],
      lines: [
        { id: "v1a", recipe_version_id: "steak-v1", sub_recipe_id: "sauce", quantity: "75", unit: "gram" },
        { id: "v1b", recipe_version_id: "steak-v1", ingredient_id: "steak-cut", quantity: "150", unit: "gram" },
        { id: "v2a", recipe_version_id: "steak-v2", sub_recipe_id: "sauce", quantity: "75", unit: "gram" },
        { id: "v2b", recipe_version_id: "steak-v2", ingredient_id: "steak-cut", quantity: "150", unit: "gram" },
        { id: "v2c", recipe_version_id: "steak-v2", ingredient_id: "oil", quantity: "10", unit: "millilitre" },
        { id: "v2d", recipe_version_id: "steak-v2", ingredient_id: "salt", quantity: "3", unit: "gram" },
        { id: "v2e", recipe_version_id: "steak-v2", ingredient_id: "pepper", quantity: "10", unit: "gram" },
        { id: "sa", recipe_version_id: "sauce-v", ingredient_id: "cream", quantity: "4000", unit: "millilitre" },
      ],
      ingredients: [
        gram("steak-cut", "Black Angus steak"),
        gram("salt", "table salt"),
        gram("pepper", "Black pepper"),
        { id: "oil", canonical_name: "Oil cooking", active: true, base_inventory_unit: "millilitre" },
        { id: "cream", canonical_name: "Double Cream", active: true, base_inventory_unit: "millilitre" },
      ],
      menuItems: [{ id: "menu-steak", name_en: "Black Angus Steak au Poivre", active: true }],
      sourceCatalog: catalog,
    });
    expect(result.supersededDrafts.map((version) => version.id)).toEqual(["steak-v1"]);
    expect(result.ok).toBe(true);
    expect(result.row.decision).toBe(ACTIVATION_DECISION.SAFE_TO_ACTIVATE);
    expect(result.row.candidate.versionId).toBe("steak-v2");
    expect(result.evidence.class).toBe(SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_CURRENT);
  });
});

describe("French Toast documentation artifact", () => {
  test("Total 220g is excluded; honey stays; unpublished subs still block", () => {
    const result = validateRecipeVersionForActivation({
      recipe: {
        id: "toast",
        name: "SPECULOOS FRENCH TOAST, RASPBERRIES, CLOTTED CREAM",
        recipe_type: "menu_item",
        menu_item_id: "menu-toast",
        active: true,
        output_quantity: "1",
      },
      versions: [
        { id: "toast-v", recipe_id: "toast", status: "draft", version_number: 1 },
        { id: "cream-v", recipe_id: "cream", status: "draft", version_number: 1 },
        { id: "spec-v", recipe_id: "spec", status: "draft", version_number: 1 },
      ],
      allRecipes: [
        { id: "toast", name: "SPECULOOS FRENCH TOAST, RASPBERRIES, CLOTTED CREAM", recipe_type: "menu_item", menu_item_id: "menu-toast", active: true, output_quantity: "1" },
        { id: "cream", name: "CLOTTED CREAM", recipe_type: "preparation", active: true, output_quantity: "1" },
        { id: "spec", name: "SPECULOS", recipe_type: "preparation", active: true, output_quantity: "1" },
      ],
      lines: [
        { id: "t1", recipe_version_id: "toast-v", ingredient_id: "bun", quantity: "80", unit: "gram" },
        { id: "t2", recipe_version_id: "toast-v", sub_recipe_id: "cream", quantity: "50", unit: "gram" },
        { id: "t3", recipe_version_id: "toast-v", ingredient_id: "berry", quantity: "40", unit: "gram" },
        { id: "t4", recipe_version_id: "toast-v", sub_recipe_id: "spec", quantity: "10", unit: "gram" },
        { id: "t5", recipe_version_id: "toast-v", ingredient_id: "honey", quantity: "20", unit: "gram" },
        { id: "t6", recipe_version_id: "toast-v", ingredient_id: "butter", quantity: "20", unit: "gram" },
        { id: "t7", recipe_version_id: "toast-v", ingredient_id: "total", quantity: "220", unit: "gram" },
        { id: "c1", recipe_version_id: "cream-v", ingredient_id: "cream-ing", quantity: "50", unit: "gram" },
        { id: "s1", recipe_version_id: "spec-v", ingredient_id: "spec-ing", quantity: "10", unit: "gram" },
      ],
      ingredients: [
        gram("bun", "French toast batter bun"),
        gram("berry", "Raspberries"),
        gram("honey", "honey"),
        gram("butter", "Butter"),
        gram("total", "Total"),
        gram("cream-ing", "Clotted cream"),
        gram("spec-ing", "Speculos"),
      ],
      menuItems: [{ id: "menu-toast", name_en: "French Toast", active: true }],
      sourceCatalog: catalog,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.reason === "documentation_artifact")).toBe(false);
    expect(result.blockers.some((item) => item.code === GRAPH_STATUS.INACTIVE_VERSION)).toBe(true);
    expect(result.evidence.class).toBe(SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_CURRENT);
    expect(result.evidence.sourceDish.lines.some((line) => /honey/i.test(line.name))).toBe(true);
  });
});

describe("House Salad dressing artifact", () => {
  test("Portions/Total/finished weight are excluded; remaining each-UOM still blocks; no honey added", () => {
    const result = validateRecipeVersionForActivation({
      recipe: {
        id: "dressing",
        name: "HOUSE SALAD DRESSING",
        recipe_type: "preparation",
        active: true,
        output_quantity: "1200",
        output_unit: "millilitre",
      },
      versions: [{ id: "d1", recipe_id: "dressing", status: "draft", version_number: 1 }],
      allRecipes: [{ id: "dressing", name: "HOUSE SALAD DRESSING", recipe_type: "preparation", active: true, output_quantity: "1200", output_unit: "millilitre" }],
      lines: [
        { id: "g1", recipe_version_id: "d1", ingredient_id: "portions", quantity: "18", unit: "each" },
        { id: "g2", recipe_version_id: "d1", ingredient_id: "total", quantity: "1200", unit: "each" },
        { id: "g3", recipe_version_id: "d1", ingredient_id: "finished", quantity: "1200", unit: "gram" },
        { id: "r1", recipe_version_id: "d1", ingredient_id: "oil", quantity: "1000", unit: "each" },
        { id: "r2", recipe_version_id: "d1", ingredient_id: "bovril", quantity: "40", unit: "each" },
        { id: "r3", recipe_version_id: "d1", ingredient_id: "soy", quantity: "80", unit: "each" },
        { id: "r4", recipe_version_id: "d1", ingredient_id: "balsamic", quantity: "80", unit: "each" },
      ],
      ingredients: [
        gram("portions", "Portions"),
        gram("total", "Total"),
        gram("finished", "finished weight"),
        { id: "oil", canonical_name: "olive oil", active: true, base_inventory_unit: "millilitre" },
        gram("bovril", "Bovril"),
        { id: "soy", canonical_name: "soy", active: true, base_inventory_unit: "millilitre" },
        { id: "balsamic", canonical_name: "balsamic", active: true, base_inventory_unit: "millilitre" },
      ],
      sourceCatalog: catalog,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === CONVERSION_STATUS.INCOMPATIBLE)).toBe(true);
    expect(result.row.decision).toBe(ACTIVATION_DECISION.REVIEW_REQUIRED);
  });
});

describe("Sweet Potato UOM blocker", () => {
  test("does not invent a gram-to-millilitre conversion for Greek yoghurt", () => {
    const result = validateRecipeVersionForActivation({
      recipe: {
        id: "potato",
        name: "HONEY SWEET POTATO, BLACK PEPPER YOGURT, ZHOUGH",
        recipe_type: "menu_item",
        menu_item_id: "menu-potato",
        active: true,
        output_quantity: "1",
      },
      versions: [{ id: "p1", recipe_id: "potato", status: "draft", version_number: 1 }],
      allRecipes: [{
        id: "potato",
        name: "HONEY SWEET POTATO, BLACK PEPPER YOGURT, ZHOUGH",
        recipe_type: "menu_item",
        menu_item_id: "menu-potato",
        active: true,
        output_quantity: "1",
      }],
      lines: [
        { id: "p1a", recipe_version_id: "p1", ingredient_id: "sp", quantity: "170", unit: "gram" },
        { id: "p1b", recipe_version_id: "p1", ingredient_id: "honey", quantity: "20", unit: "gram" },
        { id: "p1c", recipe_version_id: "p1", ingredient_id: "maldon", quantity: "2", unit: "gram" },
        { id: "p1d", recipe_version_id: "p1", ingredient_id: "yog", quantity: "50", unit: "gram" },
        { id: "p1e", recipe_version_id: "p1", ingredient_id: "zhoug", quantity: "6", unit: "gram" },
      ],
      ingredients: [
        gram("sp", "Sweet potatoes"),
        gram("honey", "Honey"),
        gram("maldon", "Smoked maldon salt"),
        { id: "yog", canonical_name: "Greek yoghurt", active: true, base_inventory_unit: "millilitre" },
        gram("zhoug", "Zhoug"),
      ],
      menuItems: [{ id: "menu-potato", name_en: "Sweet Potato", active: true }],
      sourceCatalog: catalog,
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === CONVERSION_STATUS.INCOMPATIBLE && item.lineId === "p1d")).toBe(true);
    expect(result.row.class).toBe(RECIPE_VERSION_CLASS.UNIQUE_CURRENT_DRAFT);
    expect(result.row.decision).toBe(ACTIVATION_DECISION.REVIEW_REQUIRED);
  });
});
