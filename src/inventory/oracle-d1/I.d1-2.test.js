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
