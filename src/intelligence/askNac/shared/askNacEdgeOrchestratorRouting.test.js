const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const orchestratorPath = path.join(root, "supabase/functions/_shared/askNacOrchestrator.ts");
const orchestratorSource = fs.readFileSync(orchestratorPath, "utf8");

const BROKEN_VAULT_INTENT_KEYS = [
  "ASK_NAC_INTENTS.VAULT_CASH_UP",
  "ASK_NAC_INTENTS.VAULT_MANAGEMENT_REPORT",
  "ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY",
  "ASK_NAC_INTENTS.VAULT_COVERAGE_LIST",
  "ASK_NAC_INTENTS.VAULT_GOOGLE_STARS",
  "ASK_NAC_INTENTS.VAULT_RECEPTION",
  "ASK_NAC_INTENTS.VAULT_CCM",
  "ASK_NAC_INTENTS.VAULT_LOGBOOK",
];

const REQUIRED_VAULT_INTENT_KEYS = [
  "ASK_NAC_INTENTS.CASH_UP",
  "ASK_NAC_INTENTS.MANAGEMENT_REPORT",
  "ASK_NAC_INTENTS.OPERATIONAL_DAY",
  "ASK_NAC_INTENTS.COVERAGE_LIST",
  "ASK_NAC_INTENTS.GOOGLE_STARS",
  "ASK_NAC_INTENTS.RECEPTION",
  "ASK_NAC_INTENTS.CCM",
  "ASK_NAC_INTENTS.LOGBOOK",
];

const VAULT_CASH_UP_INTENT = "vault_cash_up_summary";

function routeQuestionViaEdgeOrchestrator(question) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(orchestratorPath)}).then((mod) => {
      const route = mod.routeIntent(${JSON.stringify(question)});
      process.stdout.write(JSON.stringify({
        intent: route.intent,
        confidence: route.confidence,
        topMatchId: route.debug?.topMatches?.[0]?.id ?? null,
      }));
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;

  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });

  return JSON.parse(stdout.trim());
}

describe("Ask NAC Edge orchestrator intent routing", () => {
  test("INTENT_RULES use VAULT_INTENTS spread keys, not undefined VAULT_* aliases", () => {
    for (const brokenKey of BROKEN_VAULT_INTENT_KEYS) {
      expect(orchestratorSource).not.toContain(brokenKey);
    }
    for (const requiredKey of REQUIRED_VAULT_INTENT_KEYS) {
      expect(orchestratorSource).toContain(requiredKey);
    }
  });

  test('routes "show latest cash up" to vault_cash_up_summary with high confidence', () => {
    const route = routeQuestionViaEdgeOrchestrator("show latest cash up");
    expect(route.intent).toBe(VAULT_CASH_UP_INTENT);
    expect(route.confidence).toBe("high");
    expect(route.topMatchId).toBe(VAULT_CASH_UP_INTENT);
    expect(route.intent).not.toBeUndefined();
  });

  test.each([
    "net sales yesterday",
    "gross sales yesterday",
    "cash sales yesterday",
    "card sales yesterday",
    "sales yesterday",
  ])("routes day-metric cash-up prompt to vault_cash_up_summary: %s", (question) => {
    const route = routeQuestionViaEdgeOrchestrator(question);
    expect(route.intent).toBe(VAULT_CASH_UP_INTENT);
    expect(route.intent).not.toBeUndefined();
    expect(route.intent).not.toBe("sales_total");
  });

  test('routes "delivery apps this year" to vault_cash_up_summary, not delivery_sales stub', () => {
    const route = routeQuestionViaEdgeOrchestrator("delivery apps this year");
    expect(route.intent).toBe(VAULT_CASH_UP_INTENT);
    expect(route.intent).not.toBe("delivery_sales");
  });

  test('routes "why were sales down yesterday" to vault_business_reasoning', () => {
    const route = routeQuestionViaEdgeOrchestrator("why were sales down yesterday");
    expect(route.intent).toBe("vault_business_reasoning");
    expect(route.intent).not.toBe("sales_total");
  });
});
