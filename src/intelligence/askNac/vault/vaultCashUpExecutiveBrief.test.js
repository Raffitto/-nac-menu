import { buildCashUpExecutiveBrief } from "./vaultCashUpExecutiveBrief";
import { buildVaultCashUpAnswer } from "./vaultAnswerBuilder";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { READINESS } from "../readinessEngine";

const JUNE_17_FACT_ROWS = [
  {
    metric_key: "gross_sales",
    metric_value: 20633,
    period_end: "2026-06-17",
  },
  {
    metric_key: "net_sales",
    metric_value: 17941.73913,
    period_end: "2026-06-17",
  },
  {
    metric_key: "cash_sales",
    metric_value: 629,
    period_end: "2026-06-17",
  },
  {
    metric_key: "card_sales",
    metric_value: 19046,
    period_end: "2026-06-17",
  },
];

const JUNE_17_COVERAGE = {
  period_end: "2026-06-17",
  readiness_status: "partial",
  source_file: { title: "Cash up 2026.xlsx" },
};

describe("buildCashUpExecutiveBrief", () => {
  test("returns structured executive brief sections", () => {
    const brief = buildCashUpExecutiveBrief({
      facts: JUNE_17_FACT_ROWS,
      branchLabel: "Khobar",
      periodLabel: "17 June 2026",
      businessDate: "2026-06-17",
      fileTitle: "Cash up 2026.xlsx",
      vaultSources: [{ title: "Cash up 2026.xlsx", reportType: "cash_up", periodEnd: "2026-06-17" }],
      coverage: [JUNE_17_COVERAGE],
    });

    expect(brief.executiveSummary).toMatch(/Khobar cash-up for 2026-06-17/);
    expect(brief.executiveSummary).toMatch(/17,941\.739 SAR/);
    expect(brief.keyFindings.some((line) => /Net sales.*17,941\.739 SAR/.test(line))).toBe(true);
    expect(brief.keyFindings.some((line) => /Gross sales.*20,633 SAR/.test(line))).toBe(true);
    expect(brief.keyFindings.some((line) => /Electronic payments.*19,046 SAR/.test(line) && /629 SAR/.test(line))).toBe(
      true,
    );
    expect(brief.operationalRisks.some((line) => /partial/i.test(line))).toBe(true);
    expect(brief.recommendedActions).toEqual([]);
    expect(brief.dataSources.some((line) => /Cash up 2026\.xlsx · 2026-06-17 · cash_up/.test(line))).toBe(true);
    expect(brief.dataSources.join(" ")).not.toMatch(/Company Knowledge upload/i);
  });

  test("does not invent metric values missing from facts", () => {
    const brief = buildCashUpExecutiveBrief({
      facts: JUNE_17_FACT_ROWS,
      branchLabel: "Khobar",
      periodLabel: "17 June 2026",
    });

    const joined = [
      brief.executiveSummary,
      ...brief.keyFindings,
    ].join(" ");

    expect(joined).not.toMatch(/Guest count \d/i);
    expect(joined).not.toMatch(/Budget achievement/i);
    expect(joined).not.toMatch(/below target/i);
  });

  test("ranks revenue concentration ahead of delivery detail", () => {
    const brief = buildCashUpExecutiveBrief({
      facts: [
        ...JUNE_17_FACT_ROWS,
        { metric_key: "dinner_sales", metric_value: 17178.259, period_end: "2026-06-17" },
        { metric_key: "delivery_sales", metric_value: 328, dimensions: { platform: "chefz" }, period_end: "2026-06-17" },
      ],
      branchLabel: "Khobar",
      periodLabel: "19 June 2026",
      businessDate: "2026-06-19",
      fileTitle: "Cash up 2026.xlsx",
      coverage: [JUNE_17_COVERAGE],
    });

    const dinnerIndex = brief.keyFindings.findIndex((line) => /contributed \d+% of gross sales/.test(line));
    const deliveryIndex = brief.keyFindings.findIndex((line) => /Delivery · chefz/i.test(line));
    expect(dinnerIndex).toBeGreaterThanOrEqual(0);
    expect(deliveryIndex).toBeGreaterThanOrEqual(0);
    expect(dinnerIndex).toBeLessThan(deliveryIndex);
  });
});

describe("buildVaultCashUpAnswer executiveBrief attachment", () => {
  test("show latest cash up attaches response.executiveBrief with verified numbers", () => {
    const route = routeAskNacIntent("show latest cash up");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);

    const answer = buildVaultCashUpAnswer(
      route,
      {
        branchLabel: "Khobar",
        periodLabel: "17 June 2026",
        startDate: "2026-06-17",
        facts: JUNE_17_FACT_ROWS,
        vaultSources: [{ title: "Cash up 2026.xlsx", reportType: "cash_up", periodEnd: "2026-06-17" }],
        coverage: [JUNE_17_COVERAGE],
      },
      { status: READINESS.READY },
    );

    expect(answer.directAnswer).toMatch(/net sales of 17,941\.739 SAR/i);
    expect(answer.directAnswer).not.toBe("[object Object]");
    expect(answer.executiveBrief).toBeDefined();
    expect(answer.executiveBrief.executiveSummary).toMatch(/17,941\.739 SAR/);
    expect(answer.executiveBrief.keyFindings.length).toBeGreaterThan(0);
    expect(answer.executiveBrief.operationalRisks).toEqual(expect.any(Array));
    expect(answer.executiveBrief.recommendedActions).toEqual([]);
    expect(answer.executiveBrief.dataSources.length).toBeGreaterThan(0);
    expect(
      answer.executiveBrief.keyFindings.some(
        (line) => /20,633 SAR/.test(line) || /19,046 SAR/.test(line),
      ),
    ).toBe(true);
  });

  test("missing cash-up facts do not attach executiveBrief", () => {
    const route = routeAskNacIntent("show latest cash up");
    const answer = buildVaultCashUpAnswer(
      route,
      { branchLabel: "Khobar", periodLabel: "17 June 2026", facts: [] },
      { status: READINESS.MISSING },
    );

    expect(answer.executiveBrief).toBeNull();
  });
});
