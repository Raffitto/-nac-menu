/**
 * Oracle D1.1 follow-ups (issue6-d1-verdict.md): R1 routing precision, R2
 * fail-closed branch scope, R3 actionable available-window suggestion, R4
 * intra-day recipe version disclosure, R6 PROVISIONAL downgrades.
 */
import { ASK_NAC_INTENTS, routeAskNacIntent } from "../../intelligence/askNac/intentRouter";
import { canProfileReadBranch } from "../../lib/rbacIntelligenceScope";
import { parseConsumptionQuestion, resolveConsumptionWindow } from "../intelligence/consumptionEvidence";
import { queryIngredientConsumption } from "../intelligence/recipeConsumptionApi";
import { summarizeIngredientConsumptionWithTruth } from "../truth/ingredientConsumption";
import { allTrackedWriteCalls, trackedStub } from "../__fixtures__/oracle-d1/supabaseStub";
import {
  consumptionTables,
  latteGraph,
  SYN_BRANCH,
  SYN_INGREDIENTS,
  SYN_NOW,
  SYN_PROFILE,
  synGraph,
  synItem,
} from "../__fixtures__/oracle-d1/synFixtures";

const { routeEdgeMany } = require("./edgeHarness");

const MILK = { id: SYN_INGREDIENTS.milk.id, name: SYN_INGREDIENTS.milk.canonical_name };
const TC = ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION;

describe("R1 consumption routing needs consumption/usage wording (edge and client)", () => {
  const NEGATIVES = [
    "How much variance should we expect in Jeddah cash up?",
    "How much cash should be in the Khobar safe?",
    "How much petty cash should Khobar have?",
    "How much should Riyadh have deposited yesterday?",
    "How much should we order of milk for Khobar?",
    "How much stock should we hold in Khobar?",
    "What was our recorded wastage last week?",
    "How much should Khobar have sold yesterday?",
  ];
  const POSITIVES = [
    "How much SYN-milk should Khobar have consumed yesterday?",
    "How much SYN-milk should Khobar have consumed last week?",
    "What is the theoretical consumption of SYN-milk in Khobar yesterday?",
    "How much SYN-milk should Khobar have used yesterday?",
    "How much SYN-milk did Khobar consume yesterday?",
    "Show recipe coverage for Khobar",
    "How much SYN-milk should Khobar have consumed from 2026-10-04 to 2026-10-08?",
    "How much SYN-milk should Khobar have consumed on 2026-10-08?",
  ];
  const edge = routeEdgeMany([...NEGATIVES, ...POSITIVES]);

  test.each(NEGATIVES)("edge does not route %s to consumption", (question) => {
    expect(edge[question]).not.toBe("theoretical_consumption");
  });
  test.each(NEGATIVES)("client does not route %s to consumption", (question) => {
    expect(routeAskNacIntent(question).intent).not.toBe(TC);
  });
  test("the cash-up variance question keeps the vault cash-up route on both", () => {
    const question = "How much variance should we expect in Jeddah cash up?";
    expect(edge[question]).toBe("vault_cash_up_summary");
    expect(routeAskNacIntent(question).intent).toBe("vault_cash_up_summary");
  });
  test.each(POSITIVES)("edge and client route %s to consumption", (question) => {
    expect(edge[question]).toBe("theoretical_consumption");
    expect(routeAskNacIntent(question).intent).toBe(TC);
  });
});

describe("R2 fail-closed branch scope", () => {
  test.each([
    ["missing profile", null, "khobar", false],
    ["unauthenticated profile", { authenticated: false }, "khobar", false],
    ["branch-list-only profile, out of list", { authenticated: true, allowedBranchIds: ["riyadh"] }, "khobar", false],
    ["branch-list-only profile, in list", { authenticated: true, allowedBranchIds: ["riyadh", "khobar"] }, "khobar", true],
    ["branchScope profile, out of scope", { authenticated: true, branchScope: "riyadh" }, "khobar", false],
    ["branchScope profile, in scope", { authenticated: true, branchScope: "khobar" }, "khobar", true],
    ["authenticated profile with no scope at all", { authenticated: true }, "khobar", false],
    ["network profile", { authenticated: true, allBranches: true }, "khobar", true],
    ["network profile, unknown branch", { authenticated: true, allBranches: true }, "atlantis", false],
  ])("canProfileReadBranch: %s", (_label, profile, branch, expected) => {
    expect(canProfileReadBranch(profile, branch)).toBe(expected);
  });

  const QUESTION = "How much SYN-milk should Khobar have consumed yesterday?";
  const tables = () => consumptionTables({
    items: [synItem({ id: "SYN-I-R2", date: "2026-10-11", menuItemId: "SYN-M-LATTE" })],
    freshness: "2026-10-11",
  });

  test.each([
    ["missing profile", null],
    ["branch-list-only profile", { authenticated: true, allowedBranchIds: ["riyadh"] }],
    ["out-of-scope branch", { authenticated: true, branchScope: "riyadh" }],
  ])("tool refuses before any read: %s", async (_label, profile) => {
    const stub = trackedStub({ tables: tables() });
    const result = await queryIngredientConsumption(stub, { question: QUESTION, now: SYN_NOW, profile });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.quantity).toBeNull();
    expect(result.reason).toMatch(/cannot read that branch/);
    expect(result.postsStock).toBe(false);
    expect(stub.calls).toEqual([]);
  });

  test.each([
    ["in-scope branchScope", { authenticated: true, branchScope: "khobar" }],
    ["in-scope branch list", { authenticated: true, allowedBranchIds: ["khobar"] }],
  ])("tool answers for an %s", async (_label, profile) => {
    const stub = trackedStub({ tables: tables() });
    const result = await queryIngredientConsumption(stub, { question: QUESTION, now: SYN_NOW, profile });
    expect(result.status).toBe("PROVISIONAL");
    expect(result.quantity).toBe("100");
    expect(result.postsStock).toBe(false);
  });
});

describe("R3 the suggested available window round-trips through the parser", () => {
  const NOW = "2026-10-11T09:00:00Z";
  const items = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((date, i) => (
    synItem({ id: `SYN-I-R3-${i}`, date, menuItemId: "SYN-M-LATTE" })
  ));

  test("missing days -> suggestedQuestion; asking it gives the complete 04..08 answer", async () => {
    const stub = trackedStub({ tables: consumptionTables({ items, freshness: "2026-10-08" }) });
    const refused = await queryIngredientConsumption(stub, { question: "How much SYN-milk should Khobar have consumed last week?", now: NOW, profile: SYN_PROFILE });
    expect(refused.status).toBe("UNAVAILABLE");
    expect(refused.suggestedQuestion).toBe("How much syn-milk should Khobar have consumed from 2026-10-04 to 2026-10-08?");
    expect(refused.reason).toContain(refused.suggestedQuestion);

    expect(parseConsumptionQuestion(refused.suggestedQuestion)).toEqual({
      ingredient: "syn-milk",
      branch: "khobar",
      period: { kind: "range", start: "2026-10-04", end: "2026-10-08" },
      topic: "ingredient",
    });
    expect(routeAskNacIntent(refused.suggestedQuestion).intent).toBe(TC);
    expect(routeEdgeMany([refused.suggestedQuestion])[refused.suggestedQuestion]).toBe("theoretical_consumption");

    const answered = await queryIngredientConsumption(stub, { question: refused.suggestedQuestion, now: NOW, profile: SYN_PROFILE });
    expect(answered.status).toBe("PROVISIONAL");
    expect(answered.quantity).toBe("500");
    expect(answered.periodLabel).toBe("2026-10-04 to 2026-10-08");
  });

  test("a single complete day is suggested as 'on YYYY-MM-DD' and parses", () => {
    const window = resolveConsumptionWindow({ kind: "range", start: "2026-10-08", end: "2026-10-09" }, { now: NOW, publishedThrough: "2026-10-08" });
    expect(window.status).toBe("UNAVAILABLE");
    expect(window.suggestedPeriod).toBe("on 2026-10-08");
    const parsed = parseConsumptionQuestion(`How much SYN-milk should Khobar have consumed ${window.suggestedPeriod}?`);
    expect(parsed.period).toEqual({ kind: "range", start: "2026-10-08", end: "2026-10-08" });
    expect(resolveConsumptionWindow(parsed.period, { now: NOW, publishedThrough: "2026-10-08" })).toMatchObject({ status: "OK", start: "2026-10-08", end: "2026-10-08" });
  });

  test("invalid or reversed ranges are refused, not guessed", async () => {
    const stub = trackedStub({ tables: consumptionTables({ items, freshness: "2026-10-08" }) });
    for (const question of [
      "How much SYN-milk should Khobar have consumed from 2026-10-08 to 2026-10-04?",
      "How much SYN-milk should Khobar have consumed from 2026-02-30 to 2026-03-02?",
    ]) {
      const result = await queryIngredientConsumption(stub, { question, now: NOW, profile: SYN_PROFILE });
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.quantity).toBeNull();
      expect(result.reason).toMatch(/date range is not valid/);
    }
  });
});

describe("R4 recipe version change inside a business day is disclosed", () => {
  const graphInput = synGraph([{
    id: "SYN-R-R4",
    name: "SYN Latte",
    menuItemId: "SYN-M-LATTE",
    versions: [
      { id: "SYN-R-R4-V1", status: "retired", effectiveTo: "2026-10-10T10:00:00+03:00", lines: [{ ingredientId: MILK.id, quantity: "100", unit: "ml" }] },
      { id: "SYN-R-R4-V2", status: "active", effectiveFrom: "2026-10-10T10:00:00+03:00", lines: [{ ingredientId: MILK.id, quantity: "150", unit: "ml" }] },
    ],
  }]);
  const run = (date) => summarizeIngredientConsumptionWithTruth({
    ingredient: MILK,
    branchId: SYN_BRANCH,
    window: { start: date, end: date, label: date },
    salesRows: [{ matched_menu_item_id: "SYN-M-LATTE", raw_item_name: "SYN Latte", quantity_sold: 1, business_date: date }],
    graphInput,
    sales: { complete: true, orderStatusVerified: true },
  });

  test("sale on the change day: disclosed, V2 applied", () => {
    const result = run("2026-10-10");
    expect(result.quantity).toBe("150");
    expect(result.versionChangesWithinDay).toEqual([
      { recipeId: "SYN-R-R4", recipeName: "SYN Latte", businessDate: "2026-10-10", changedAt: "10:00 AST" },
    ]);
    expect(result.reason).toMatch(/changed during business day 2026-10-10 \(at 10:00 AST\)/);
  });

  test("sale on another day, or a change at midnight AST: nothing to disclose", () => {
    expect(run("2026-10-11").versionChangesWithinDay).toEqual([]);
    const midnight = synGraph([{
      id: "SYN-R-R4M",
      name: "SYN Latte",
      menuItemId: "SYN-M-LATTE",
      versions: [
        { id: "M1", status: "retired", effectiveTo: "2026-10-10T00:00:00+03:00", lines: [{ ingredientId: MILK.id, quantity: "100", unit: "ml" }] },
        { id: "M2", status: "active", effectiveFrom: "2026-10-10T00:00:00+03:00", lines: [{ ingredientId: MILK.id, quantity: "150", unit: "ml" }] },
      ],
    }]);
    const result = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" },
      salesRows: [{ matched_menu_item_id: "SYN-M-LATTE", raw_item_name: "SYN Latte", quantity_sold: 1, business_date: "2026-10-10" }],
      graphInput: midnight,
      sales: { complete: true, orderStatusVerified: true },
    });
    expect(result.versionChangesWithinDay).toEqual([]);
  });

  test("a change in a nested sub-recipe is disclosed too", () => {
    const nested = synGraph([
      { id: "SYN-R-BASE", name: "SYN Base", outputQuantity: "1", outputUnit: "each", versions: [
        { id: "B1", status: "retired", effectiveTo: "2026-10-10T15:30:00+03:00", lines: [{ ingredientId: MILK.id, quantity: "100", unit: "ml" }] },
        { id: "B2", status: "active", effectiveFrom: "2026-10-10T15:30:00+03:00", lines: [{ ingredientId: MILK.id, quantity: "120", unit: "ml" }] },
      ] },
      { id: "SYN-R-TOP", name: "SYN Shake", menuItemId: "SYN-M-SHAKE", lines: [{ subRecipeId: "SYN-R-BASE", quantity: "1", unit: "each" }] },
    ]);
    const result = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK,
      branchId: SYN_BRANCH,
      window: { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" },
      salesRows: [{ matched_menu_item_id: "SYN-M-SHAKE", raw_item_name: "SYN Shake", quantity_sold: 1, business_date: "2026-10-10" }],
      graphInput: nested,
      sales: { complete: true, orderStatusVerified: true },
    });
    expect(result.quantity).toBe("120");
    expect(result.versionChangesWithinDay).toEqual([
      { recipeId: "SYN-R-BASE", recipeName: "SYN Base", businessDate: "2026-10-10", changedAt: "15:30 AST" },
    ]);
  });
});

describe("R6 PROVISIONAL is downgraded when publication or recipe coverage is unknown", () => {
  const QUESTION = "How much SYN-milk should Khobar have consumed yesterday?";
  const latte = synItem({ id: "SYN-I-R6", date: "2026-10-11", menuItemId: "SYN-M-LATTE", name: "SYN Latte" });

  test("no freshness row -> PARTIAL, no total, covered subset kept", async () => {
    const stub = trackedStub({ tables: consumptionTables({ items: [latte] }) });
    const result = await queryIngredientConsumption(stub, { question: QUESTION, now: SYN_NOW, profile: SYN_PROFILE });
    expect(result.status).toBe("PARTIAL");
    expect(result.quantity).toBeNull();
    expect(result.coveredSubset).toMatchObject({ quantity: "100", unit: "millilitre" });
    expect(result.reason).toMatch(/could not be confirmed \(no freshness record exists for this branch\)/);
    expect(result.postsStock).toBe(false);
  });

  test("freshness unreadable -> PARTIAL", async () => {
    const stub = trackedStub({
      tables: consumptionTables({ items: [latte] }),
      errors: { commerce_dataset_freshness: { message: "permission denied for commerce_dataset_freshness" } },
    });
    const result = await queryIngredientConsumption(stub, { question: QUESTION, now: SYN_NOW, profile: SYN_PROFILE });
    expect(result.status).toBe("PARTIAL");
    expect(result.quantity).toBeNull();
    expect(result.reason).toMatch(/freshness record could not be read/);
  });

  test("a sold product with no recipe -> PARTIAL with the product listed", async () => {
    const water = synItem({ id: "SYN-I-R6W", date: "2026-10-11", menuItemId: "SYN-M-WATER", name: "SYN Water", quantity: 2 });
    const stub = trackedStub({ tables: consumptionTables({ items: [latte, water], freshness: "2026-10-11" }) });
    const result = await queryIngredientConsumption(stub, { question: QUESTION, now: SYN_NOW, profile: SYN_PROFILE });
    expect(result.status).toBe("PARTIAL");
    expect(result.quantity).toBeNull();
    expect(result.coveredSubset.quantity).toBe("100");
    expect(result.uncoveredProducts).toEqual([
      { product: "SYN Water", menuItemId: "SYN-M-WATER", soldQuantity: "2", reason: "no_active_recipe" },
    ]);
    expect(result.reason).toMatch(/SYN Water \(no active Food Bible recipe\)/);
  });

  test("fresh publication and full recipe coverage stay PROVISIONAL", async () => {
    const stub = trackedStub({ tables: consumptionTables({ items: [latte], freshness: "2026-10-11", graph: latteGraph() }) });
    const result = await queryIngredientConsumption(stub, { question: QUESTION, now: SYN_NOW, profile: SYN_PROFILE });
    expect(result.status).toBe("PROVISIONAL");
    expect(result.quantity).toBe("100");
  });
});

describe("T28 (H)", () => {
  test("no insert/update/upsert/delete/rpc on any stub in this file", () => {
    expect(allTrackedWriteCalls()).toEqual([]);
  });
});
