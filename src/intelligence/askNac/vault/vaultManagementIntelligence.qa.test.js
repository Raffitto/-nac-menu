/**
 * Management Intelligence QA regressions (10 Aug 2026 production findings).
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
} from "./vaultPeriodParser";
import {
  buildCashUpPeriodAggregateAnswer,
  buildCashUpPeriodCompareMetrics,
  buildDayRankingAnswer,
  buildMatchedCoverageComparison,
  buildPerformanceOverviewAnswer,
  scoreSalesPerformanceQueryFocus,
} from "./vaultSalesPerformanceIntelligence";
import { computeSourceComposition } from "../executive/executiveEvidenceV2";
import { ASK_NAC_INTENTS } from "../intentRouter";

const REF = new Date("2026-08-10T12:00:00.000Z");
const EDGE_ORCHESTRATOR = path.resolve(
  __dirname,
  "../../../../supabase/functions/_shared/askNacOrchestrator.ts",
);

function routeViaEdge(question, referenceDate = REF) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(EDGE_ORCHESTRATOR)}).then((mod) => {
      const route = mod.routeIntent(${JSON.stringify(question)}, {
        referenceDate: new Date(${JSON.stringify(referenceDate.toISOString())}),
      });
      process.stdout.write(JSON.stringify({
        intent: route.intent,
        confidence: route.confidence,
        performanceOverview: Boolean(route.performanceOverview),
        queryFocus: route.queryFocus || null,
        branchMention: route.branchMention || null,
        vaultPeriod: route.vaultPeriod || null,
        vaultCompare: route.vaultCompare || null,
      }));
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.resolve(__dirname, "../../../.."),
    encoding: "utf8",
  });
  return JSON.parse(stdout.trim());
}

function makeDay(date, totalSales, totalGuests = 100, totalOrders = 40) {
  return {
    date,
    totalSales,
    totalGuests,
    totalOrders,
    averageSpend: totalGuests ? totalSales / totalGuests : null,
    totalDeliverySales: 0,
    totalDeliveryOrders: 0,
  };
}

describe("Ask NAC management intelligence QA", () => {
  test("compare last 7 vs previous 7 routes to structured cash-up comparison (not Foodics)", () => {
    const q = "Compare the last 7 days with the previous 7 days for NAC Khobar";
    const compare = parseVaultComparePeriodsFromQuestion(q, REF);
    expect(compare?.current?.startDate).toBe("2026-08-04");
    expect(compare?.current?.endDate).toBe("2026-08-10");
    expect(compare?.previous?.startDate).toBe("2026-07-28");
    expect(compare?.previous?.endDate).toBe("2026-08-03");
    // Non-overlapping windows
    expect(compare.previous.endDate < compare.current.startDate).toBe(true);

    const route = routeViaEdge(q);
    expect(route.intent).toBe("vault_cash_up_summary");
    expect(route.intent).not.toMatch(/sales_total|top_items|foodics/i);
    expect(route.queryFocus).toBe("period_compare");
    expect(route.branchMention).toBe("khobar");
    expect(route.vaultCompare?.current?.startDate).toBe("2026-08-04");
    expect(route.vaultCompare?.previous?.startDate).toBe("2026-07-28");
    expect(scoreSalesPerformanceQueryFocus(q)).toBe("period_compare");
  });

  test("How did July perform overall? resolves to July 2026 full month, never latest day", () => {
    const q = "How did July perform overall?";
    const period = parseVaultPeriodFromQuestion(q, REF);
    expect(period?.periodType).toBe("named_month");
    expect(period?.startDate).toBe("2026-07-01");
    expect(period?.endDate).toBe("2026-07-31");

    const route = routeViaEdge(q);
    expect(route.intent).toBe("vault_cash_up_summary");
    expect(route.performanceOverview).toBe(true);
    expect(route.vaultPeriod?.startDate).toBe("2026-07-01");
    expect(route.vaultPeriod?.endDate).toBe("2026-07-31");
    expect(route.vaultPeriod?.startDate).not.toBe("2026-08-08");
    expect(route.vaultPeriod?.endDate).not.toBe("2026-08-08");
  });

  test("named month without year uses current relevant year", () => {
    const period = parseVaultPeriodFromQuestion("How was June?", REF);
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-30");
  });

  test("strongest/weakest days last 30 days routes to sales day ranking", () => {
    const q = "What were our strongest and weakest days in the last 30 days?";
    expect(scoreSalesPerformanceQueryFocus(q)).toBe("day_ranking");
    const period = parseVaultPeriodFromQuestion(q, REF);
    expect(period?.expectedDayCount).toBe(30);
    expect(period?.startDate).toBe("2026-07-12");
    expect(period?.endDate).toBe("2026-08-10");

    const route = routeViaEdge(q);
    expect(route.intent).toBe("vault_cash_up_summary");
    expect(route.queryFocus).toBe("day_ranking");
    expect(route.vaultPeriod?.startDate).toBe("2026-07-12");
    expect(route.vaultPeriod?.endDate).toBe("2026-08-10");
    expect(route.confidence).not.toBe("none");
  });

  test("day ranking answer uses requested period and Khobar label", () => {
    const aggregation = {
      dayCount: 3,
      expectedDayCount: 30,
      dailyBreakdown: [
        makeDay("2026-07-20", 10000),
        makeDay("2026-07-21", 25000),
        makeDay("2026-07-22", 8000),
      ],
    };
    const answer = buildDayRankingAnswer(aggregation, {
      branchLabel: "Khobar",
      periodLabel: "last 30 days",
    });
    expect(answer).toMatch(/Khobar/);
    expect(answer).not.toMatch(/Network/);
    expect(answer).toMatch(/Strongest day: 2026-07-21/);
    expect(answer).toMatch(/Weakest day: 2026-07-22/);
    expect(answer).toMatch(/last 30 days/);
    expect(answer).toMatch(/3 of 30/);
  });

  test("operational review route keeps last-10-days period for retrieval", () => {
    const q = "What are the biggest operational issues from the last 10 days?";
    const route = routeViaEdge(q);
    expect(route.intent).toBe("vault_operational_review");
    expect(route.vaultPeriod?.startDate).toBe("2026-08-01");
    expect(route.vaultPeriod?.endDate).toBe("2026-08-10");
    // Out-of-window 2025 logbooks must not be treated as the requested period.
    expect(route.vaultPeriod?.startDate?.startsWith("2025")).toBe(false);
  });

  test("strictMetadata option is available for operational retrieval", () => {
    const src = require("fs").readFileSync(
      path.join(__dirname, "vaultDocumentSearchRetrieval.js"),
      "utf8",
    );
    expect(src).toMatch(/strictMetadata/);
    expect(src).toMatch(/!strictMetadata/);
    const tools = require("fs").readFileSync(
      path.join(__dirname, "vaultQueryTools.js"),
      "utf8",
    );
    expect(tools).toMatch(/strictMetadata:\s*hasRequestedPeriod/);
  });

  test("structured commercial composition prioritizes Cash Up labels", () => {
    const composition = computeSourceComposition(
      {
        aggregation: { dayCount: 8 },
        structuredFacts: { cash_up: [{ id: 1 }] },
        historicalDashboards: [{ id: "d1" }, { id: "d2" }, { id: "d3" }],
        operatorMemory: [{ fact: "x" }],
        branchMemory: [],
        manualInputs: [],
      },
      {},
      { intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY },
    );
    expect(composition.qualitative).toBe(true);
    expect(composition.composition[0].source).toMatch(/Cash Up/i);
    expect(composition.composition[0].role).toBe("primary");
    const text = composition.composition.map((r) => `${r.percent}% ${r.source}`).join("\n");
    expect(text).not.toMatch(/94% historical/i);
  });

  test("branch-specific overview says Khobar not Network", () => {
    const aggregation = {
      totalSales: 147254.783,
      totalGuests: 2191,
      totalOrders: 879,
      averageSpend: 67.209,
      dayCount: 8,
      expectedDayCount: 10,
      missingDayCount: 2,
      dailyBreakdown: [
        makeDay("2026-08-01", 25578),
        makeDay("2026-08-03", 12356),
      ],
    };
    const answer = buildPerformanceOverviewAnswer(
      "How did NAC Khobar perform over the last 10 days?",
      aggregation,
      { branchLabel: "Khobar", periodLabel: "last 10 days" },
    );
    expect(answer).toMatch(/^Khobar recorded/);
    expect(answer).not.toMatch(/^Network recorded/);
  });

  test("compare metrics never expose raw missing_daily_breakdown", () => {
    const metrics = buildCashUpPeriodCompareMetrics(
      {
        dayCount: 8,
        expectedDayCount: 10,
        requestedStartDate: "2026-08-01",
        requestedEndDate: "2026-08-10",
        totalSales: 100,
        dailyBreakdown: [],
      },
      {
        dayCount: 8,
        expectedDayCount: 10,
        requestedStartDate: "2026-07-22",
        requestedEndDate: "2026-07-31",
        totalSales: 110,
        dailyBreakdown: [],
      },
    );
    const blob = JSON.stringify(metrics);
    expect(blob).not.toMatch(/missing_daily_breakdown/);
    expect(blob).toMatch(/Daily sales breakdown not available|Not like-for-like/i);
  });

  test("in-range logbook evidence suppresses false missing logbook claim", () => {
    const { buildExecutiveEvidenceMapV2 } = require("../executive/executiveEvidenceV2");
    const map = buildExecutiveEvidenceMapV2(
      {
        structuredFacts: {},
        historicalDashboards: [],
        operatorMemory: [],
        branchMemory: [],
        coverage: [],
        aggregation: { dayCount: 5 },
      },
      {
        intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
        tool: {
          matches: [{ reportType: "daily_logbook", excerpt: "AC issue" }],
          groupedFindings: [{ theme: "facilities" }],
        },
      },
    );
    const missing = (map.missingInformation || []).map((m) => m.label).join(" | ");
    expect(missing).not.toMatch(/Daily logbook entries/i);
  });

  test("matched coverage overview remains correct for partial 10-day windows", () => {
    const current = {
      totalSales: 147254.783,
      totalGuests: 2191,
      averageSpend: 67.209,
      dayCount: 8,
      expectedDayCount: 10,
      requestedStartDate: "2026-08-01",
      requestedEndDate: "2026-08-10",
      dailyBreakdown: [
        makeDay("2026-08-01", 20000, 300, 100),
        makeDay("2026-08-02", 18000, 280, 90),
        makeDay("2026-08-03", 12000, 200, 70),
        makeDay("2026-08-04", 18000, 270, 95),
        makeDay("2026-08-05", 14000, 220, 80),
        makeDay("2026-08-06", 19000, 290, 100),
        makeDay("2026-08-07", 24000, 350, 120),
        makeDay("2026-08-08", 22254.783, 281, 124),
      ],
    };
    const previous = {
      totalSales: 160691.304,
      totalGuests: 2300,
      averageSpend: 69.866,
      dayCount: 10,
      expectedDayCount: 10,
      requestedStartDate: "2026-07-22",
      requestedEndDate: "2026-07-31",
      dailyBreakdown: [
        makeDay("2026-07-22", 16000, 230, 90),
        makeDay("2026-07-23", 16100, 231, 93),
        makeDay("2026-07-24", 16000, 230, 91),
        makeDay("2026-07-25", 16200, 232, 94),
        makeDay("2026-07-26", 16000, 230, 92),
        makeDay("2026-07-27", 16100, 231, 93),
        makeDay("2026-07-28", 16091.304, 228, 91),
        makeDay("2026-07-29", 16100, 234, 92),
        makeDay("2026-07-30", 16100, 234, 92),
        makeDay("2026-07-31", 16000, 220, 90),
      ],
    };
    const comparison = buildMatchedCoverageComparison(current, previous);
    expect(comparison.mode).toBe("matched");
    const answer = buildCashUpPeriodAggregateAnswer(
      "How did NAC Khobar perform over the last 10 days?",
      current,
      {
        branchLabel: "Khobar",
        periodLabel: "last 10 days",
        previousAggregation: previous,
        previousPeriodLabel: "previous 10 days",
      },
    );
    expect(answer).toMatch(/like-for-like/i);
    expect(answer).not.toMatch(/down 8\.4%/i);
    expect(answer).not.toMatch(/missing_daily_breakdown/);
  });

  test("partial July coverage answers July window without substituting August", () => {
    const aggregation = {
      totalSales: 500000,
      totalGuests: 7000,
      dayCount: 20,
      expectedDayCount: 31,
      requestedStartDate: "2026-07-01",
      requestedEndDate: "2026-07-31",
      dailyBreakdown: [makeDay("2026-07-01", 20000), makeDay("2026-07-15", 10000)],
    };
    const answer = buildPerformanceOverviewAnswer("How did July perform overall?", aggregation, {
      branchLabel: "Khobar",
      periodLabel: "July 2026",
    });
    expect(answer).toMatch(/July 2026|20 available days|requested 31/);
    expect(answer).not.toMatch(/8 August|2026-08-08/);
  });
});
