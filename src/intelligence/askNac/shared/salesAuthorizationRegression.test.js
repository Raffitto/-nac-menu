import { getBatchForExportPeriod, getBatchSalesItems } from "../../../lib/foodicsApi";
import { getFoodicsTopItems } from "../foodics/foodicsQueryTools";
import { resolveFoodicsPeriodWithFallback } from "./periodFallback";
import { getVaultCashUpFactsOverRange, getVaultCoverage } from "../vault/vaultQueryTools";
import { fetchExecutiveMemory } from "../executive/executiveMemory";
import { collectWeeklyDashboardData } from "../executive/weeklyDashboardDataCollector";
import { aggregateCashUpFactsOverRange } from "../vault/vaultCashUpAggregation";
import { buildCashUpPeriodAggregateAnswer } from "../vault/vaultSalesPerformanceIntelligence";
import { authorizeSalesBranches } from "./salesBranchAuthorization";

jest.mock("../../../lib/supabase", () => ({
  isSupabaseConfigured: () => true,
}));

jest.mock("../../../lib/foodicsApi", () => ({
  getBatchForExportPeriod: jest.fn(),
  getBatchSalesItems: jest.fn(),
  getImportBatches: jest.fn(),
}));

const KHOBAR = {
  authenticated: true,
  allBranches: false,
  branchScope: "khobar",
  allowedBranchIds: ["khobar"],
};
const COMPANY = { authenticated: true, allBranches: true, branchScope: null };

function countingSupabase(rows = []) {
  const calls = [];
  const api = {
    select() { return api; },
    eq() { return api; },
    lte() { return api; },
    gte() { return api; },
    neq() { return api; },
    in() { return api; },
    order() { return api; },
    limit() { return api; },
    or() { return api; },
    not() { return api; },
    is() { return api; },
    filter() { return api; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(resolve, reject) {
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return {
    calls,
    from(table) {
      calls.push(table);
      return api;
    },
    rpc(name) {
      calls.push(`rpc:${name}`);
      return Promise.resolve({ data: { totalSales: 1, dayCount: 1, dailyBreakdown: [] }, error: null });
    },
  };
}

function isoDays(start, count) {
  const days = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function periodFacts(dates, { khobar = 100, riyadh = 40, duplicateKhobar = null } = {}) {
  const facts = [];
  for (const date of dates) {
    facts.push(
      { branch_id: "khobar", metric_key: "net_sales", metric_value: khobar, period_start: date, period_end: date, dimensions: {}, file_version_id: "v1" },
      { branch_id: "riyadh", metric_key: "net_sales", metric_value: riyadh, period_start: date, period_end: date, dimensions: {}, file_version_id: "v1" },
      { branch_id: "khobar", metric_key: "guest_count", metric_value: 10, period_start: date, period_end: date, dimensions: {}, file_version_id: "v1" },
      { branch_id: "riyadh", metric_key: "guest_count", metric_value: 4, period_start: date, period_end: date, dimensions: {}, file_version_id: "v1" },
    );
  }
  if (duplicateKhobar != null && dates[0]) {
    facts.push({
      branch_id: "khobar",
      metric_key: "net_sales",
      metric_value: duplicateKhobar,
      period_start: dates[0],
      period_end: dates[0],
      dimensions: {},
      source_row_ref: "pdf-day-stale",
    });
  }
  return facts;
}

describe("sales authorization fails closed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("missing profile and missing branch permissions are denied; company-wide access stays allowed", () => {
    expect(authorizeSalesBranches(null, { mentionedBranch: "khobar" }).ok).toBe(false);
    expect(authorizeSalesBranches({ authenticated: false, allBranches: true }, { mentionedBranch: "riyadh" }).ok).toBe(false);
    expect(authorizeSalesBranches({ authenticated: true, allBranches: false, allowedBranchIds: [] }, {}).ok).toBe(false);
    const company = authorizeSalesBranches(COMPANY, {});
    expect(company.ok).toBe(true);
    expect(company.companyWide).toBe(true);
    expect(company.branches).toEqual(["khobar", "riyadh", "jeddah"]);
    const khobar = authorizeSalesBranches(KHOBAR, { mentionedBranch: "khobar" });
    expect(khobar.ok).toBe(true);
    expect(authorizeSalesBranches(KHOBAR, { mentionedBranch: "riyadh" }).ok).toBe(false);
  });

  test("Foodics, Cash Up, coverage, memory, and weekly dashboard do not query before a denial", async () => {
    const supabase = countingSupabase();
    const deniedContext = {
      profile: KHOBAR,
      branchMention: "riyadh",
      filters: { branch: "riyadh" },
      question: "top items in riyadh last 7 days",
      foodicsPeriod: { startDate: "2026-10-01", endDate: "2026-10-07", label: "last 7 days" },
      vaultPeriod: { startDate: "2026-10-01", endDate: "2026-10-07", periodLabel: "last 7 days" },
    };

    const topItems = await getFoodicsTopItems(supabase, deniedContext);
    const coverage = await getVaultCoverage(supabase, {
      profile: KHOBAR,
      branch: "riyadh",
      branchMention: "riyadh",
      reportType: "cash_up",
      startDate: "2026-10-01",
      endDate: "2026-10-07",
    });
    const cashUp = await getVaultCashUpFactsOverRange(supabase, deniedContext);
    const memory = await fetchExecutiveMemory(supabase, { branch: "riyadh", profile: KHOBAR });
    const period = await resolveFoodicsPeriodWithFallback(supabase, {
      question: "top items",
      branch: "riyadh",
      profile: KHOBAR,
      filters: { branch: "riyadh" },
    });
    const dashboard = await collectWeeklyDashboardData(supabase, {
      branch: "riyadh",
      vaultPeriod: { startDate: "2026-10-01", endDate: "2026-10-07", periodLabel: "last 7 days" },
      profile: KHOBAR,
    });

    expect(topItems.authorizationDenied).toBe(true);
    expect(coverage.authorizationDenied).toBe(true);
    expect(cashUp.authorizationDenied).toBe(true);
    expect(memory.authorizationDenied || memory.branchMemories).toBeTruthy();
    expect(memory.branchMemories || []).toEqual([]);
    expect(period.period).toBeNull();
    expect(dashboard.authorizationDenied).toBe(true);
    expect(supabase.calls).toEqual([]);
    expect(getBatchForExportPeriod).not.toHaveBeenCalled();
    expect(getBatchSalesItems).not.toHaveBeenCalled();
  });
});

describe("cash-up 7 and 30 day totals", () => {
  test("sums distinct business dates and branches and ignores a stale same-branch revision", () => {
    const dates = isoDays("2026-09-01", 7);
    const facts = periodFacts(dates, { khobar: 100, riyadh: 40, duplicateKhobar: 9000 });
    const factsByDate = {};
    for (const fact of facts) {
      if (!factsByDate[fact.period_end]) factsByDate[fact.period_end] = [];
      factsByDate[fact.period_end].push({
        ...fact,
        branchId: fact.branch_id,
        metricKey: fact.metric_key,
        metricValue: fact.metric_value,
        periodEnd: fact.period_end,
        fileVersionId: fact.file_version_id,
        sourceRowRef: fact.source_row_ref,
      });
    }
    const agg = aggregateCashUpFactsOverRange({
      startDate: dates[0],
      endDate: dates[6],
      factsByDate,
    });
    expect(agg.totalSales).toBe(7 * 140);
    expect(agg.totalSales).not.toBe(100);
    expect(agg.totalSales).not.toBe(9000);
    expect(agg.dayCount).toBe(7);
    expect(agg.missingDayCount).toBe(0);
    expect(agg.branchesIncluded).toEqual(["khobar", "riyadh"]);
    expect(agg.branchCoverageLabel).toBe("Khobar and Riyadh");
    expect(agg.salesCoverageStart).toBe(dates[0]);
    expect(agg.salesCoverageEnd).toBe(dates[6]);
    const answer = buildCashUpPeriodAggregateAnswer("sales last 7 days", agg, {
      branchLabel: "Network",
      periodLabel: "last 7 days",
    });
    expect(answer).toMatch(/Khobar and Riyadh/);
    expect(answer).toMatch(/980/);
    expect(answer).not.toMatch(/\b100 SAR\b/);
  });

  test("a 30-day execution sums every authorized branch-day instead of the first row", async () => {
    const dates = isoDays("2026-09-01", 30);
    const rows = periodFacts(dates, { khobar: 10, riyadh: 5 });
    const supabase = countingSupabase(rows);
    const result = await getVaultCashUpFactsOverRange(supabase, {
      profile: COMPANY,
      question: "what are sales for the last 30 days",
      vaultPeriod: {
        startDate: dates[0],
        endDate: dates[29],
        label: "last 30 days",
        periodType: "last_30_days",
      },
    });
    expect(result.authorizationDenied).toBeUndefined();
    expect(result.aggregation.totalSales).toBe(30 * 15);
    expect(result.aggregation.dayCount).toBe(30);
    expect(result.aggregation.missingDayCount).toBe(0);
    expect(result.aggregation.branchesIncluded).toEqual(["khobar", "riyadh"]);
    expect(result.aggregation.salesCoverageStart).toBe("2026-09-01");
    expect(result.aggregation.salesCoverageEnd).toBe("2026-09-30");
    expect(result.branchLabel).toBe("Khobar and Riyadh");
    expect(supabase.calls).toContain("ask_nac_structured_facts");
    expect(supabase.calls.some((name) => String(name).startsWith("rpc:"))).toBe(false);
    const answer = buildCashUpPeriodAggregateAnswer("sales last 30 days", result.aggregation, {
      branchLabel: result.branchLabel,
      periodLabel: "last 30 days",
    });
    expect(answer).toMatch(/Khobar and Riyadh/);
    expect(answer).toMatch(/450/);
    expect(answer).toMatch(/30 cash-up day/);
  });
});
