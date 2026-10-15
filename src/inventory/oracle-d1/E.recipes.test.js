/**
 * Oracle D1 — E. Recipes, SKUs, coverage (T18-T23).
 * Recovered Foodics export edges are EVIDENCE only (never counted); the Food
 * Bible graph (src/inventory/truth) is the only source of totals.
 */
import {
  buildRecoveredEdgeIndex,
  classifyRecipeEdges,
  EVIDENCE_SOURCE,
  RECOVERED_CONFLICT_REASON,
  RECOVERED_EDGE_CLASS,
  recoveredEvidenceForIngredient,
  recoveredLinksForIngredient,
} from "../intelligence/foodicsRecipeRecovery";
import { buildRecipeGraph, expandRecipeToIngredients } from "../truth/recipeGraph";
import { computeTheoreticalLedger } from "../truth/consumption";
import { GRAPH_STATUS } from "../truth/contracts";
import { summarizeIngredientConsumptionWithTruth } from "../truth/ingredientConsumption";
import { allTrackedWriteCalls } from "../__fixtures__/oracle-d1/supabaseStub";
import { SYN_BRANCH, SYN_INGREDIENTS, SYN_RECOVERED, synGraph } from "../__fixtures__/oracle-d1/synFixtures";

const index = buildRecoveredEdgeIndex(SYN_RECOVERED);
const MILK = { id: SYN_INGREDIENTS.milk.id, name: SYN_INGREDIENTS.milk.canonical_name };
const DAY = { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" };
const FULL_READ = { complete: true, orderStatusVerified: true, source: "canonical_commerce" };

function sale(productId, name, quantity = 1, menuItemId = null) {
  return { foodics_product_id: productId, raw_item_name: name, matched_menu_item_id: menuItemId, quantity_sold: quantity, business_date: "2026-10-10" };
}

describe("T18 shared parent SKU detection", () => {
  test("SYN-sk-A (SYN Burger + SYN Ice Cream) is CONFLICT: parent_sku_multiple_names", () => {
    const classified = index.classifyRecipeEdges("SYN-sk-A");
    expect(classified.parentConflict).toBe(RECOVERED_CONFLICT_REASON.PARENT_SKU_MULTIPLE_NAMES);
    expect(classified.usable).toEqual([]);
    for (const edge of classified.conflicts) {
      expect(edge.class).toBe(RECOVERED_EDGE_CLASS.CONFLICT);
      expect(edge.reason).toBe("parent_sku_multiple_names");
    }
  });

  test("a SYN Burger sale gets no SYN-Milk link", () => {
    const sales = [sale("SYN-PROD-BURGER", "SYN Burger", 1)];
    expect(recoveredLinksForIngredient(sales, "SYN-Milk", { index })).toEqual([]);
    expect(recoveredEvidenceForIngredient(sales, "SYN-Milk", { index }).excluded).toEqual([
      expect.objectContaining({ product: "SYN Burger", reason: "conflict", detail: "parent_sku_multiple_names" }),
    ]);
  });

  test("committed fixture: sk-0629 and sk-0632 are conflicts", () => {
    expect(classifyRecipeEdges("sk-0629").parentConflict).toBe("parent_sku_multiple_names");
    expect(classifyRecipeEdges("sk-0632").parentConflict).toBe("parent_sku_multiple_names");
    expect(classifyRecipeEdges("sk-0629").usable).toEqual([]);
  });
});

describe("T19 child SKU colliding with a product SKU", () => {
  test("child SYN-sk-B named SYN-Dressing while SYN-sk-B is SYN Coffee: CONFLICT child_sku_is_other_product", () => {
    const edge = SYN_RECOVERED.edges.find((row) => row.childName === "SYN-Dressing");
    expect(index.classifyEdge(edge)).toMatchObject({ class: "CONFLICT", reason: "child_sku_is_other_product" });
    const evidence = recoveredEvidenceForIngredient([sale("SYN-PROD-SALAD", "SYN Salad")], "SYN-Dressing", { index });
    expect(evidence.links).toEqual([]);
    expect(evidence.excluded).toEqual([expect.objectContaining({ product: "SYN Salad", reason: "conflict", detail: "child_sku_is_other_product" })]);
    // SKU identity is not used: a SYN Coffee lookup does not pick up the dressing.
    expect(recoveredLinksForIngredient([sale("SYN-PROD-COFFEE", "SYN Coffee")], "SYN-Dressing", { index })).toEqual([]);
  });

  test("committed fixture: sk-0657 used as 'NAC-Truffle Salad Dressing' is not a usable edge", () => {
    const edge = { parentSku: "sk-2179", parentName: "L. Combo 4 - Truffle Burger & Fries", childSku: "sk-0657", childName: "NAC-Truffle Salad Dressing", qty: "12.5", unit: "Gm" };
    const classified = classifyRecipeEdges("sk-2179");
    const hit = [...classified.conflicts, ...classified.usable, ...classified.incomplete].find((row) => row.childSku === edge.childSku && row.childName === edge.childName);
    expect(hit).toBeDefined();
    expect(hit.class).toBe("CONFLICT");
  });
});

/** R1 (menu SYN-M1) = 30 gram SYN-Fruit + sub-recipe R2 (missing). */
function t20Graph() {
  return synGraph([
    { id: "SYN-R1", name: "SYN-M1 Bowl", menuItemId: "SYN-M1", lines: [
      { ingredientId: SYN_INGREDIENTS.fruit.id, quantity: "30", unit: "gram" },
      { subRecipeId: "SYN-R2-MISSING", quantity: "1", unit: "each" },
    ] },
  ]);
}

describe("T20 partial expansion is not 'covered'", () => {
  test("ledger reports R1 as partial, not covered, and gives no 60 gram total", () => {
    const graphInput = t20Graph();
    const ledger = computeTheoreticalLedger({
      salesRows: [{ matched_menu_item_id: "SYN-M1", raw_item_name: "SYN-M1 Bowl", quantity_sold: 2, business_date: "2026-10-10" }],
      graph: buildRecipeGraph(graphInput),
      periodStart: DAY.start,
      periodEnd: DAY.end,
    });
    expect(ledger.coverage.recipePartialSoldRows).toBe(1);
    expect(ledger.coverage.recipeCoveredSoldRows).toBe(0);
    expect(ledger.partialSales).toEqual([expect.objectContaining({ menuItemId: "SYN-M1", recipeId: "SYN-R1" })]);
    const fruit = ledger.rows.find((row) => row.canonicalIngredientId === SYN_INGREDIENTS.fruit.id);
    if (fruit) {
      expect(fruit.completeness).toBe("PARTIAL");
      expect(fruit.quantityTheoreticallyConsumed).toBeNull();
      expect(fruit.partialMenuItems.map((item) => item.menuItemId)).toContain("SYN-M1");
    }
  });

  test("Ask NAC summariser: SYN-Fruit is UNAVAILABLE with R1 listed, never '60 gram, covered 1 of 1'", () => {
    const result = summarizeIngredientConsumptionWithTruth({
      ingredient: { id: SYN_INGREDIENTS.fruit.id, name: "SYN-Fruit" },
      branchId: SYN_BRANCH,
      window: DAY,
      salesRows: [{ matched_menu_item_id: "SYN-M1", raw_item_name: "SYN-M1 Bowl", quantity_sold: 2, business_date: "2026-10-10" }],
      graphInput: t20Graph(),
      sales: FULL_READ,
    });
    expect(["UNAVAILABLE", "PARTIAL"]).toContain(result.status);
    expect(result.quantity).toBeNull();
    expect(result.excluded).toEqual([expect.objectContaining({ product: "SYN-M1 Bowl", reason: "incomplete" })]);
    expect(result.reason).toMatch(/SYN-M1 Bowl/);
    expect(result.postsStock).toBe(false);
  });
});

describe("T21 never a total while any sold product is incomplete or conflicted", () => {
  test("Food Bible: SYN-P1 complete (100 Ml) + SYN-P2 with blank SYN-Milk quantity -> PARTIAL, P2 excluded", () => {
    const graphInput = synGraph([
      { id: "SYN-R-P1", name: "SYN-P1", menuItemId: "SYN-M-P1", lines: [{ ingredientId: MILK.id, quantity: "100", unit: "Ml" }] },
      { id: "SYN-R-P2", name: "SYN-P2", menuItemId: "SYN-M-P2", lines: [{ ingredientId: MILK.id, quantity: null, unit: null }] },
    ]);
    const result = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: DAY,
      salesRows: [sale(null, "SYN-P1", 2, "SYN-M-P1"), sale(null, "SYN-P2", 1, "SYN-M-P2")],
      graphInput,
      sales: FULL_READ,
    });
    expect(result.status).toBe("PARTIAL");
    expect(result.quantity).toBeNull();
    expect(result.coveredSubset).toMatchObject({ quantity: "200", unit: "millilitre" });
    expect(result.excluded).toEqual([expect.objectContaining({ product: "SYN-P2", reason: "incomplete" })]);
    expect(result.postsStock).toBe(false);
  });

  test("export evidence: SYN-P2 soaking-mix line with blank qty -> excluded; no total", () => {
    const graphInput = synGraph([
      { id: "SYN-R-P1", name: "SYN-P1", menuItemId: "SYN-M-P1", lines: [{ ingredientId: MILK.id, quantity: "100", unit: "Ml" }] },
    ]);
    const salesRows = [sale("SYN-PROD-P1", "SYN-P1", 1, "SYN-M-P1"), sale("SYN-PROD-P2", "SYN-P2", 1, null)];
    const result = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: DAY,
      salesRows,
      graphInput,
      sales: FULL_READ,
      recoveredEvidence: recoveredEvidenceForIngredient(salesRows, "SYN-Milk", { index }),
    });
    expect(["UNAVAILABLE", "PARTIAL"]).toContain(result.status);
    expect(result.quantity).toBeNull();
    expect(result.excluded).toEqual([expect.objectContaining({ product: "SYN-P2", reason: "incomplete" })]);
    if (result.status === "PARTIAL") expect(result.coveredSubset.quantity).toBe("100");
    expect(result.postsStock).toBe(false);
  });
});

describe("T22 provenance labels", () => {
  const exportIndex = buildRecoveredEdgeIndex({
    products: [...SYN_RECOVERED.products, { id: "SYN-PROD-SHAKE", sku: "SYN-sk-SHAKE", name: "SYN Shake" }],
    edges: [...SYN_RECOVERED.edges, { parentSku: "SYN-sk-SHAKE", parentName: "SYN Shake", childSku: "SYN-sk-MILK", childName: "SYN-Milk", qty: "200", unit: "Ml" }],
  });
  const graphInput = synGraph([
    { id: "SYN-R-P1", name: "SYN-P1", menuItemId: "SYN-M-P1", lines: [{ ingredientId: MILK.id, quantity: "100", unit: "Ml" }] },
  ]);

  test("Food Bible link and export link carry distinct sources; status is not PROVISIONAL", () => {
    const salesRows = [sale("SYN-PROD-P1", "SYN-P1", 1, "SYN-M-P1"), sale("SYN-PROD-SHAKE", "SYN Shake", 1, null)];
    const result = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: DAY,
      salesRows,
      graphInput,
      sales: FULL_READ,
      recoveredEvidence: recoveredEvidenceForIngredient(salesRows, "SYN-Milk", { index: exportIndex }),
    });
    expect(result.links).toEqual([expect.objectContaining({ product: "SYN-P1", source: EVIDENCE_SOURCE.FOOD_BIBLE_MENU_LINK })]);
    expect(result.unverifiedEvidence).toEqual([expect.objectContaining({ product: "SYN Shake", source: EVIDENCE_SOURCE.FOODICS_EXPORT_UNVERIFIED, countsTowardTotal: false })]);
    expect(result.status).not.toBe("PROVISIONAL");
    expect(result.quantity).toBeNull();
    expect(result.verification).not.toMatch(/not (marked )?verified against a Foodics recipe export/i);
    expect(result.verification).toMatch(/unverified/i);
  });

  test("unverified export links alone never give PROVISIONAL", () => {
    const salesRows = [sale("SYN-PROD-SHAKE", "SYN Shake", 3, null)];
    const result = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: DAY,
      salesRows,
      graphInput: synGraph([]),
      sales: FULL_READ,
      recoveredEvidence: recoveredEvidenceForIngredient(salesRows, "SYN-Milk", { index: exportIndex }),
    });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.quantity).toBeNull();
    expect(result.reason).toMatch(/unverified/);
    expect(result.postsStock).toBe(false);
  });
});

describe("T23 nested BOM, cycle, yield", () => {
  const ingredientQty = (expansion, id) => expansion.ingredients.get(id)?.quantityBase;

  test("(a) R2 yields 1 litre with 200 ml SYN-Milk; R1 uses 250 ml of R2 -> 50 ml", () => {
    const graph = buildRecipeGraph(synGraph([
      { id: "SYN-R2", name: "SYN Base", outputQuantity: "1", outputUnit: "litre", lines: [{ ingredientId: MILK.id, quantity: "200", unit: "ml" }] },
      { id: "SYN-R1", name: "SYN Drink", menuItemId: "SYN-M-DRINK", lines: [{ subRecipeId: "SYN-R2", quantity: "250", unit: "ml" }] },
    ]));
    const expansion = expandRecipeToIngredients({ recipeId: "SYN-R1", outputNeeded: "1", graph });
    expect(expansion.issues).toEqual([]);
    expect(Number(ingredientQty(expansion, MILK.id))).toBe(50);
  });

  test("(b) R3 -> R4 -> R3 is CIRCULAR and the driver is not covered", () => {
    const graphInput = synGraph([
      { id: "SYN-R3", name: "SYN Loop A", menuItemId: "SYN-M-LOOP", lines: [{ subRecipeId: "SYN-R4", quantity: "1", unit: "each" }], outputUnit: "each" },
      { id: "SYN-R4", name: "SYN Loop B", outputUnit: "each", lines: [{ subRecipeId: "SYN-R3", quantity: "1", unit: "each" }, { ingredientId: MILK.id, quantity: "10", unit: "ml" }] },
    ]);
    const graph = buildRecipeGraph(graphInput);
    const expansion = expandRecipeToIngredients({ recipeId: "SYN-R3", outputNeeded: "1", graph });
    expect(expansion.issues.map((issue) => issue.code)).toContain(GRAPH_STATUS.CIRCULAR);
    const ledger = computeTheoreticalLedger({
      salesRows: [{ matched_menu_item_id: "SYN-M-LOOP", raw_item_name: "SYN Loop A", quantity_sold: 1, business_date: "2026-10-10" }],
      graph,
    });
    expect(ledger.coverage.recipeCoveredSoldRows).toBe(0);
    expect(ledger.coverage.recipePartialSoldRows).toBe(1);
  });

  test("(c) R5 with source-backed 80% yield and a 40 g line -> 50 g, yield applied once", () => {
    const graphInput = synGraph([
      { id: "SYN-R5", name: "SYN Dough", outputQuantity: "1", outputUnit: "each", yield: 80, lines: [{ ingredientId: SYN_INGREDIENTS.flour.id, quantity: "40", unit: "g" }] },
      { id: "SYN-R6", name: "SYN Bread", menuItemId: "SYN-M-BREAD", lines: [{ subRecipeId: "SYN-R5", quantity: "1", unit: "each" }] },
    ]);
    const graph = buildRecipeGraph(graphInput);
    const direct = expandRecipeToIngredients({ recipeId: "SYN-R5", outputNeeded: "1", graph });
    expect(Number(ingredientQty(direct, SYN_INGREDIENTS.flour.id))).toBe(50);
    const nested = expandRecipeToIngredients({ recipeId: "SYN-R6", outputNeeded: "1", graph });
    expect(nested.issues).toEqual([]);
    expect(Number(ingredientQty(nested, SYN_INGREDIENTS.flour.id))).toBe(50);
  });
});

describe("T28 (E)", () => {
  test("no insert/update/upsert/delete/rpc on any stub in this file", () => {
    expect(allTrackedWriteCalls()).toEqual([]);
  });
});
