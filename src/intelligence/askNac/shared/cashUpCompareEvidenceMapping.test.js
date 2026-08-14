/**
 * Production v90: last 10 vs previous 10 comparison periods survive Fabric,
 * cash_up_compare runs, but previous/delta never reach evidence/synthesis.
 *
 * This test uses the live getVaultCashUpFactsOverRange return shape
 * (aggregation + previousAggregation, no `comparison` object) and asserts
 * usable current+previous comparison metrics at the evidence/synthesis boundary.
 */
const path = require("path");
const { execFileSync } = require("child_process");
const { parseVaultComparePeriodsFromQuestion } = require("../vault/vaultPeriodParser");
const { buildMatchedCoverageComparison } = require("../vault/cashUpMatchedCoverageComparison");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const REF = new Date("2026-08-14T16:16:00.000Z");
const QUESTION = "What about last 10 days compared to the previous 10 days?";

function run(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return JSON.parse(stdout.trim());
}

function isoAdd(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function buildAggregation({ start, end, missing = [], sales = 1000, guests = 20 }) {
  const dailyBreakdown = [];
  let dayCount = 0;
  let totalSales = 0;
  let totalGuests = 0;
  for (let i = 0; ; i += 1) {
    const date = isoAdd(start, i);
    if (date > end) break;
    if (missing.includes(date)) continue;
    dailyBreakdown.push({ date, totalSales: sales, totalGuests: guests, totalOrders: 10 });
    dayCount += 1;
    totalSales += sales;
    totalGuests += guests;
  }
  const expected = Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000) + 1;
  return {
    totalSales,
    totalGuests,
    totalOrders: dayCount * 10,
    averageSpend: dayCount ? totalSales / totalGuests : null,
    dayCount,
    expectedDayCount: expected,
    missingDayCount: Math.max(0, expected - dayCount),
    requestedStartDate: start,
    requestedEndDate: end,
    dailyBreakdown,
  };
}

describe("cash_up_compare evidence mapping (v90 production gap)", () => {
  const compare = parseVaultComparePeriodsFromQuestion(QUESTION, REF);
  const currentAgg = buildAggregation({
    start: "2026-08-05",
    end: "2026-08-14",
    missing: ["2026-08-14"],
    sales: 16481.686,
    guests: 244,
  });
  const previousAgg = buildAggregation({
    start: "2026-07-26",
    end: "2026-08-04",
    sales: 15000,
    guests: 220,
  });
  const vaultSafeComparison = buildMatchedCoverageComparison(currentAgg, previousAgg);

  const rawCashUpCompare = {
    branch: "khobar",
    branchLabel: "Khobar",
    startDate: "2026-08-05",
    endDate: "2026-08-14",
    periodLabel: "last 10 days vs previous 10 days",
    facts: [],
    coverage: [],
    aggregation: currentAgg,
    previousAggregation: previousAgg,
    vaultCompare: compare,
    warnings: [],
    sources: [{ name: "ask_nac_structured_facts", detail: "multi-day cash-up compare aggregation" }],
  };

  test("parser periods match production last 10 vs previous 10", () => {
    expect(compare?.current?.startDate).toBe("2026-08-05");
    expect(compare?.current?.endDate).toBe("2026-08-14");
    expect(compare?.previous?.startDate).toBe("2026-07-26");
    expect(compare?.previous?.endDate).toBe("2026-08-04");
  });

  test("vault layer can compute a safe comparison from both aggregations", () => {
    expect(currentAgg.dayCount).toBe(9);
    expect(currentAgg.expectedDayCount).toBe(10);
    expect(previousAgg.dayCount).toBe(10);
    expect(vaultSafeComparison.mode).not.toBe("full");
    expect(
      vaultSafeComparison.currentMatched?.totalSales != null
      || vaultSafeComparison.currentAvgDailySales != null,
    ).toBe(true);
    expect(
      vaultSafeComparison.previousMatched?.totalSales != null
      || vaultSafeComparison.previousAvgDailySales != null,
    ).toBe(true);
  });

  test("usable current+previous comparison metrics reach evidence/synthesis (production v90 gap)", () => {
    const out = run(`
      const raw = ${JSON.stringify(rawCashUpCompare)};
      const calls = [];
      const executor = mod.createVaultCapabilityExecutor(async ({ request }) => {
        calls.push({
          capability: request.capability,
          branchId: request.branchId,
          currentStart: request.currentPeriod?.startDate || null,
          currentEnd: request.currentPeriod?.endDate || null,
          compareStart: request.comparisonPeriod?.startDate || null,
          compareEnd: request.comparisonPeriod?.endDate || null,
          method: request.comparabilityMethod || null,
        });
        return raw;
      });
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: { authenticated: true, allBranches: false, branchScope: "khobar" },
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: ${JSON.stringify(QUESTION)},
        scope: authorized.scope,
        referenceDate: new Date("2026-08-14T16:16:00.000Z"),
        mode: "heuristic",
        executor,
      });
      const compareCall = calls.find((c) => c.capability === "commercial.compare");
      const compareTool = spine.state.toolResults["commercial.compare"] || null;
      const evidence = spine.state.evidence || [];
      const evidenceKeys = evidence.map((e) => e.metricOrEvent);
      const previousEvidence = evidence.filter((e) => {
        const period = e.period || {};
        return period.startDate === "2026-07-26" || /previous|delta_pct|matched|daily_average|avg_daily/i.test(String(e.metricOrEvent || ""));
      });
      const synthesisReads = {
        net_sales: evidence.find((e) => e.metricOrEvent === "net_sales" && typeof e.value === "number") || null,
        covers: evidence.find((e) => e.metricOrEvent === "covers" && typeof e.value === "number") || null,
        delta_pct: evidence.find((e) => e.metricOrEvent === "delta_pct" && typeof e.value === "number") || null,
      };
      return {
        compareCall,
        comparability: spine.state.comparability,
        current: spine.state.periods.current,
        comparison: spine.state.periods.comparison,
        tools: spine.toolsExecuted,
        rawKeys: Object.keys(raw),
        rawPreviousSales: raw.previousAggregation?.totalSales ?? null,
        rawPreviousDays: raw.previousAggregation?.dayCount ?? null,
        rawHasComparisonObject: raw.comparison != null,
        mappedMetrics: compareTool?.metrics || [],
        mappedComparison: compareTool?.comparison || null,
        evidenceKeys,
        previousEvidence,
        synthesisReads,
        answer: String(spine.answerText || ""),
      };
    `);

    expect(out.compareCall).toEqual(expect.objectContaining({
      capability: "commercial.compare",
      branchId: "khobar",
      currentStart: "2026-08-05",
      currentEnd: "2026-08-14",
      compareStart: "2026-07-26",
      compareEnd: "2026-08-04",
    }));
    expect(out.comparability?.status).toBe("partially_comparable");
    expect(out.comparability?.recommendedMethod).toBe("matched_weekday");
    expect(out.tools).toContain("cash_up_compare");
    expect(out.rawPreviousSales).toBe(previousAgg.totalSales);
    expect(out.rawPreviousDays).toBe(10);
    expect(out.rawHasComparisonObject).toBe(false);

    const usablePrevious = out.previousEvidence.some((e) => e.value != null)
      || out.synthesisReads.delta_pct != null
      || (out.mappedComparison && (
        out.mappedComparison.previous?.value != null
        || out.mappedComparison.percentChange != null
      ));
    expect(usablePrevious).toBe(true);

    expect(currentAgg.totalSales).toBeCloseTo(148335.174, 3);
    expect(currentAgg.dayCount).toBe(9);
    expect(previousAgg.totalSales).toBe(150000);
    expect(previousAgg.dayCount).toBe(10);
    expect(vaultSafeComparison.mode).toBe("matched");
    expect(vaultSafeComparison.matchedDayCount).toBe(9);
    expect(vaultSafeComparison.currentMatched.totalSales).toBeCloseTo(148335.174, 3);
    expect(vaultSafeComparison.previousMatched.totalSales).toBe(135000);
    expect(vaultSafeComparison.currentAvgDailySales).toBeCloseTo(16481.686, 3);
    expect(vaultSafeComparison.previousAvgDailySales).toBe(15000);

    const cmp = out.mappedComparison;
    expect(cmp.matchedDayCount).toBe(9);
    expect(cmp.current.value).toBeCloseTo(148335.174, 3);
    expect(cmp.previous.value).toBe(135000);
    const matchedPct = ((148335.174 - 135000) / 135000) * 100;
    const rawTotalPct = ((148335.174 - 150000) / 150000) * 100;
    expect(cmp.percentChange).toBeCloseTo(matchedPct, 5);
    expect(cmp.percentChange).not.toBeCloseTo(rawTotalPct, 5);
    expect(cmp.delta).toBeCloseTo(148335.174 - 135000, 3);

    const deltaEvidence = out.synthesisReads.delta_pct;
    expect(deltaEvidence).not.toBeNull();
    expect(Number(deltaEvidence.value)).toBeCloseTo(matchedPct, 5);
    expect(Number(deltaEvidence.value)).not.toBeCloseTo(rawTotalPct, 5);
    expect(String(out.answer)).toMatch(/like-for-like/i);
  });
});
