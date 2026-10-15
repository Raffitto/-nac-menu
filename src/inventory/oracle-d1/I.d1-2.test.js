/**
 * Oracle D1.2 (issue6-d11-verdict.md): R1b routing word lists on BOTH routers,
 * R2 strict authentication, R6 refinements (see the R6 describe block).
 *
 * The routing probes are Oracle's full D1.1 re-validation set
 * (/workspace/nac-audit/d11-probes: qs.json 59 + qs2.mjs 9 = 68), committed as
 * src/inventory/__fixtures__/oracle-d1/routingProbes.json with the expected
 * route per router. The same fixture runs under Deno for the edge
 * (supabase/functions/_shared/askNacConsumptionHandoff.test.ts).
 */
import { ASK_NAC_INTENTS, routeAskNacIntent } from "../../intelligence/askNac/intentRouter";
import { canProfileReadBranch } from "../../lib/rbacIntelligenceScope";
import { parseConsumptionQuestion } from "../intelligence/consumptionEvidence";
import PROBES from "../__fixtures__/oracle-d1/routingProbes.json";

const { routeEdgeMany } = require("./edgeHarness");

const TC = ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION;
const NOT_TC = "!theoretical_consumption";

function matches(expected, actual) {
  return expected === NOT_TC ? actual !== TC : actual === expected;
}

describe("R1b Oracle routing probes (68) on the edge and client routers", () => {
  const probes = PROBES.probes;
  const edge = routeEdgeMany([...new Set(probes.map((p) => p.question))]);
  const rows = probes.map((p, i) => [i + 1, p.category, p.question, p.expect]);

  test("the committed probe set is Oracle's complete 68", () => {
    expect(probes).toHaveLength(68);
    expect(probes.filter((p) => p.source === "qs.json")).toHaveLength(59);
    expect(probes.filter((p) => p.source === "qs2.mjs")).toHaveLength(9);
  });

  test.each(rows)("edge probe %i [%s] %s", (_i, _cat, question, expected) => {
    expect({ question, route: edge[question], ok: matches(expected.edge, edge[question]) })
      .toEqual({ question, route: edge[question], ok: true });
  });

  test.each(rows)("client probe %i [%s] %s", (_i, _cat, question, expected) => {
    const route = routeAskNacIntent(question).intent;
    expect({ question, route, ok: matches(expected.client, route) })
      .toEqual({ question, route, ok: true });
  });

  test("edge and client agree on consumption vs not-consumption for every probe", () => {
    const disagreements = probes
      .filter((p) => (edge[p.question] === TC) !== (routeAskNacIntent(p.question).intent === TC))
      .map((p) => p.question);
    expect(disagreements).toEqual([]);
  });

  test("every probe routed to consumption names an ingredient the local tool can parse", () => {
    const unparsed = probes
      .filter((p) => p.expect.client === TC)
      .filter((p) => !parseConsumptionQuestion(p.question)?.ingredient)
      .map((p) => p.question);
    expect(unparsed).toEqual([]);
  });
});

describe("R1b named cases from the verdict", () => {
  const POSITIVE = [
    "How much chicken stock should Khobar have used yesterday?",
    "How much beef stock should Riyadh have consumed last week?",
    "How much milk should Khobar have used given its stock yesterday?",
    "How much milk did Khobar use yesterday?",
    "How much milk does Khobar use per day?",
    "What was the milk usage in Khobar last week?",
    "Milk consumption Khobar yesterday",
    "How much milk was used for the drinks sold in Khobar yesterday?",
    "How much milk should Khobar have used based on sales yesterday?",
  ];
  const NEGATIVE = [
    "How much card payment was used in Khobar yesterday?",
    "How much discount was used in Riyadh last week?",
    "How much mada was used in Jeddah last week?",
    "How much of the budget was used in Khobar last week?",
    "How much cash was used to buy milk in Khobar yesterday?",
    "How much in tips did Khobar get yesterday?",
    "How much refund amount was used in Khobar yesterday?",
    "How much voucher value was used in Riyadh last week?",
    "How much stock should we hold in Khobar?",
    "What is the stock level of milk in Khobar?",
    "What is the par level for milk in Khobar?",
    "How much milk is in stock in Riyadh?",
    "Card payment usage Khobar yesterday",
  ];
  const edge = routeEdgeMany([...POSITIVE, ...NEGATIVE]);

  test.each(POSITIVE)("consumption on both routers: %s", (q) => {
    expect([edge[q], routeAskNacIntent(q).intent]).toEqual([TC, TC]);
  });
  test.each(NEGATIVE)("not consumption on either router: %s", (q) => {
    expect(edge[q]).not.toBe(TC);
    expect(routeAskNacIntent(q).intent).not.toBe(TC);
  });
  test("ingredient names containing 'stock' parse as the ingredient", () => {
    expect(parseConsumptionQuestion("How much chicken stock should Khobar have used yesterday?"))
      .toMatchObject({ ingredient: "chicken stock", branch: "khobar", period: "yesterday" });
    expect(parseConsumptionQuestion("Milk consumption Khobar yesterday"))
      .toMatchObject({ ingredient: "milk", branch: "khobar", period: "yesterday" });
  });
});

describe("R2 canProfileReadBranch requires authenticated === true", () => {
  test.each([["yes"], [1], ["true"], [{}], [[]]])("authenticated %p is denied", (authenticated) => {
    expect(canProfileReadBranch({ authenticated, allBranches: true }, "khobar")).toBe(false);
  });
  test("authenticated true with allBranches is allowed", () => {
    expect(canProfileReadBranch({ authenticated: true, allBranches: true }, "khobar")).toBe(true);
  });
});

describe("R6 refinements: lower bound, reason codes, no-tracked-ingredients flag, ranked gaps", () => {
  // eslint-disable-next-line global-require
  const { summarizeIngredientConsumptionWithTruth, PARTIAL_REASON } = require("../truth/ingredientConsumption");
  // eslint-disable-next-line global-require
  const { formatConsumptionAnswer } = require("../intelligence/consumptionEvidence");
  // eslint-disable-next-line global-require
  const { SYN_BRANCH, SYN_INGREDIENTS, synGraph } = require("../__fixtures__/oracle-d1/synFixtures");
  const MILK = { id: SYN_INGREDIENTS.milk.id, name: SYN_INGREDIENTS.milk.canonical_name };
  const WEEK = { start: "2026-10-04", end: "2026-10-10", label: "2026-10-04 to 2026-10-10" };
  const VERIFIED = { complete: true, orderStatusVerified: true, source: "canonical_commerce", publicationVerified: true };
  const UNVERIFIED = { ...VERIFIED, publicationVerified: false, publicationNote: "no freshness record exists for this branch" };
  const sale = (menuItemId, name, quantity, date = "2026-10-10") => ({
    foodics_product_id: null, raw_item_name: name, matched_menu_item_id: menuItemId, quantity_sold: quantity, business_date: date,
  });
  const LATTE = { id: "SYN-R-LATTE", name: "SYN Latte", menuItemId: "SYN-M-LATTE", lines: [{ ingredientId: MILK.id, quantity: "100", unit: "Ml" }] };
  const run = ({ recipes = [LATTE], salesRows, sales = VERIFIED }) => summarizeIngredientConsumptionWithTruth({
    ingredient: MILK, branchId: SYN_BRANCH, window: WEEK, salesRows, graphInput: synGraph(recipes), sales,
  });

  test("recipe gap with confirmed publication: PARTIAL, no total, 'at least' lower bound, unit share, one reason code", () => {
    const result = run({ salesRows: [sale("SYN-M-LATTE", "SYN Latte", 1), sale("SYN-M-WATER", "SYN Water", 2)] });
    expect(result.status).toBe("PARTIAL");
    expect(result.quantity).toBeNull();
    expect(result.reasonCodes).toEqual([PARTIAL_REASON.RECIPE_COVERAGE]);
    expect(result.lowerBound).toEqual({
      quantity: "100",
      unit: "millilitre",
      label: "At least 100 millilitre. A lower bound from complete Food Bible products only; this is not a total.",
    });
    expect(result.unitCoverage).toMatchObject({ unitsSold: "3", unitsCounted: "1", sharePercent: 33.3 });
    expect(result.reason).toMatch(/known for 1 of 3 units sold \(33\.3%\)/);
    const text = formatConsumptionAnswer(result);
    expect(text).toMatch(/no total/);
    expect(text).toMatch(/At least 100 millilitre/);
    expect(text).not.toMatch(/SYN-Milk: 100/);
  });

  test("unconfirmed publication only: PUBLICATION_UNVERIFIED, lower bound withheld", () => {
    const result = run({ salesRows: [sale("SYN-M-LATTE", "SYN Latte", 1)], sales: UNVERIFIED });
    expect(result.status).toBe("PARTIAL");
    expect(result.quantity).toBeNull();
    expect(result.reasonCodes).toEqual([PARTIAL_REASON.PUBLICATION_UNVERIFIED]);
    expect(result.lowerBound).toBeNull();
    expect(result.lowerBoundWithheld).toMatch(/refund/);
    expect(result.coveredSubset.quantity).toBe("100");
  });

  test("both gaps carry both codes", () => {
    const result = run({ salesRows: [sale("SYN-M-LATTE", "SYN Latte", 1), sale("SYN-M-WATER", "SYN Water", 1)], sales: UNVERIFIED });
    expect(result.reasonCodes).toEqual([PARTIAL_REASON.RECIPE_COVERAGE, PARTIAL_REASON.PUBLICATION_UNVERIFIED]);
    expect(result.lowerBound).toBeNull();
  });

  test("uncovered products are one entry each, ranked by units sold", () => {
    const result = run({
      salesRows: [
        sale("SYN-M-LATTE", "SYN Latte", 1),
        sale("SYN-M-WATER", "SYN Water", 1, "2026-10-08"),
        sale("SYN-M-JUICE", "SYN Juice", 3, "2026-10-08"),
        sale("SYN-M-WATER", "SYN Water", 4, "2026-10-09"),
      ],
    });
    expect(result.uncoveredProducts.map((item) => [item.product, item.soldQuantity])).toEqual([["SYN Water", "5"], ["SYN Juice", "3"]]);
    expect(result.reason.indexOf("SYN Water")).toBeLessThan(result.reason.indexOf("SYN Juice"));
  });

  test("explicit Food Bible noTrackedIngredients flag does not block PROVISIONAL", () => {
    const water = { id: "SYN-R-WATER", name: "SYN Water", menuItemId: "SYN-M-WATER", versions: [{ status: "active", lines: [], documentation: { noTrackedIngredients: true } }] };
    const result = run({ recipes: [LATTE, water], salesRows: [sale("SYN-M-LATTE", "SYN Latte", 1), sale("SYN-M-WATER", "SYN Water", 2)] });
    expect(result.status).toBe("PROVISIONAL");
    expect(result.quantity).toBe("100");
    expect(result.noTrackedIngredientItems).toEqual([
      { product: "SYN Water", menuItemId: "SYN-M-WATER", soldQuantity: "2", noTrackedIngredients: true },
    ]);
    expect(result.reasonCodes).toEqual([]);
  });

  test("an empty recipe WITHOUT the flag is a coverage gap (never inferred from name or emptiness)", () => {
    const water = { id: "SYN-R-WATER", name: "SYN Water", menuItemId: "SYN-M-WATER", versions: [{ status: "active", lines: [] }] };
    const result = run({ recipes: [LATTE, water], salesRows: [sale("SYN-M-LATTE", "SYN Latte", 1), sale("SYN-M-WATER", "SYN Water", 2)] });
    expect(result.status).toBe("PARTIAL");
    expect(result.quantity).toBeNull();
    expect(result.uncoveredProducts).toEqual([
      { product: "SYN Water", menuItemId: "SYN-M-WATER", soldQuantity: "2", reason: "recipe_has_no_ingredients_unflagged" },
    ]);
    expect(result.noTrackedIngredientItems).toEqual([]);
  });

  test("T20/T21 still hold: an incomplete product leaves no total; no contributions -> UNAVAILABLE without a lower bound", () => {
    const blank = { id: "SYN-R-P2", name: "SYN-P2", menuItemId: "SYN-M-P2", lines: [{ ingredientId: MILK.id, quantity: null, unit: null }] };
    const partial = run({ recipes: [LATTE, blank], salesRows: [sale("SYN-M-LATTE", "SYN Latte", 2), sale("SYN-M-P2", "SYN-P2", 1)] });
    expect(partial.status).toBe("PARTIAL");
    expect(partial.quantity).toBeNull();
    expect(partial.lowerBound.label).toMatch(/^At least 200 millilitre\..*not a total/);
    expect(partial.unitCoverage).toMatchObject({ unitsSold: "3", unitsCounted: "2" });
    const none = run({ recipes: [blank], salesRows: [sale("SYN-M-P2", "SYN-P2", 1)] });
    expect(none.status).toBe("UNAVAILABLE");
    expect(none.quantity).toBeNull();
    expect(none.lowerBound).toBeUndefined();
  });
});
