/**
 * Oracle D1 — G. Regression guards (T27, T28).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import edgesFile from "../intelligence/data/foodicsRecipeEdges.json";
import productsFile from "../intelligence/data/foodicsProductIndex.json";
import { summarizeRecoveredFixture } from "../intelligence/foodicsRecipeRecovery";
import { queryIngredientConsumption } from "../intelligence/recipeConsumptionApi";
import { allTrackedWriteCalls, trackedStub, trackedStubCount } from "../__fixtures__/oracle-d1/supabaseStub";
import { consumptionTables, SYN_NOW, synItem } from "../__fixtures__/oracle-d1/synFixtures";

const norm = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

describe("T27 fixture guard", () => {
  const edges = edgesFile.edges;
  const products = productsFile.products;

  test("fixture bytes are pinned (any change forces review of these counts)", () => {
    const dir = path.resolve(__dirname, "../intelligence/data");
    const sha = (name) => crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex");
    expect({
      edges: sha("foodicsRecipeEdges.json"),
      products: sha("foodicsProductIndex.json"),
    }).toEqual({
      edges: "699ccb308ff3b3f48e5b9fec2639ccbfe9b744157850b4d2f734626d73370902",
      products: "f55ba711b56850220b869917f54386fe2222b3a9bc7fb9619495e91239c3b9e8",
    });
  });

  test("recomputed counts: 2 multi-name parents, 51 conflict + 107 incomplete edges, 88 child-SKU/product collisions", () => {
    const parentNames = new Map();
    for (const edge of edges) {
      if (!parentNames.has(edge.parentSku)) parentNames.set(edge.parentSku, new Set());
      parentNames.get(edge.parentSku).add(norm(edge.parentName));
    }
    const multi = [...parentNames.entries()].filter(([, names]) => names.size > 1).map(([sku]) => sku).sort();
    const incomplete = edges.filter((edge) => !edge.qty || !edge.unit);
    const conflictShape = edges.filter((edge) => parentNames.has(edge.childSku) && !parentNames.get(edge.childSku).has(norm(edge.childName)));
    const conflictNotIncomplete = conflictShape.filter((edge) => edge.qty && edge.unit);
    const productNames = new Map();
    for (const product of products) {
      if (!product.sku) continue;
      if (!productNames.has(product.sku)) productNames.set(product.sku, new Set());
      productNames.get(product.sku).add(norm(product.name));
    }
    const collisions = edges.filter((edge) => productNames.has(edge.childSku) && !productNames.get(edge.childSku).has(norm(edge.childName)));
    expect({
      edges: edges.length,
      products: products.length,
      multiNameParents: multi,
      incompleteEdges: incomplete.length,
      conflictShapeEdges: conflictShape.length,
      conflictEdgesNotIncomplete: conflictNotIncomplete.length,
      childSkuProductCollisions: collisions.length,
      collidingChildSkus: new Set(collisions.map((edge) => edge.childSku)).size,
    }).toEqual({
      edges: 882,
      products: 673,
      multiNameParents: ["sk-0629", "sk-0632"],
      incompleteEdges: 107,
      conflictShapeEdges: 62,
      conflictEdgesNotIncomplete: 51,
      childSkuProductCollisions: 88,
      collidingChildSkus: 49,
    });
  });

  test("classifier output is pinned (precedence: multi-name > incomplete > sub-recipe conflict > product collision)", () => {
    expect(summarizeRecoveredFixture()).toEqual({
      edges: 882,
      products: 673,
      parentSkus: expect.any(Number),
      byClass: { USABLE_UNVERIFIED: 690, CONFLICT: 91, INCOMPLETE: 101 },
      byReason: {
        parent_sku_multiple_names: 23,
        missing_quantity_or_unit: 101,
        parent_name_disagrees_with_ingredient_name: 50,
        child_sku_is_other_product: 18,
      },
    });
  });
});

describe("T28 no stock writes", () => {
  test("Ask NAC consumption end to end across scenarios: only reads, never insert/update/upsert/delete/rpc", async () => {
    const tablesTouched = new Set();
    const scenarios = [
      { question: "How much SYN-milk should Khobar have consumed yesterday?", items: [synItem({ id: "SYN-I-G1", date: "2026-10-11", menuItemId: "SYN-M-LATTE" })] },
      { question: "How much SYN-milk should Khobar have consumed last week?", items: [synItem({ id: "SYN-I-G2", date: "2026-10-08", menuItemId: "SYN-M-LATTE", quantity: 2 })] },
      { question: "How much SYN-milk did Khobar consume today?", items: [] },
      { question: "How much SYN-unknown should Khobar have used yesterday?", items: [] },
    ];
    for (const scenario of scenarios) {
      const stub = trackedStub({ tables: consumptionTables({ items: scenario.items, freshness: "2026-10-11" }) });
      const result = await queryIngredientConsumption(stub, { question: scenario.question, now: SYN_NOW });
      expect(result.postsStock).toBe(false);
      for (const call of stub.calls) if (call.table) tablesTouched.add(call.table);
      const methods = new Set(stub.calls.map((call) => call.method));
      for (const forbidden of ["insert", "update", "upsert", "delete", "rpc"]) expect(methods.has(forbidden)).toBe(false);
    }
    expect([...tablesTouched].sort()).toEqual([
      "commerce_dataset_freshness",
      "commerce_order_items",
      "commerce_orders",
      "inventory_ingredients",
      "inventory_recipe_version_lines",
      "inventory_recipe_versions",
      "inventory_recipes",
    ]);
    expect(trackedStubCount()).toBe(4);
    expect(allTrackedWriteCalls()).toEqual([]);
  });

  test("static guard: the D1 read modules contain no write or rpc calls", () => {
    const root = path.resolve(__dirname, "..");
    const files = [
      "truth/readers.js",
      "truth/ingredientConsumption.js",
      "truth/salesSource.js",
      "truth/consumption.js",
      "intelligence/recipeConsumptionApi.js",
      "intelligence/consumptionEvidence.js",
      "intelligence/foodicsRecipeRecovery.js",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect({ file, writes: source.match(/\.(insert|update|upsert|delete|rpc)\s*\(/g) || [] }).toEqual({ file, writes: [] });
    }
  });
});
