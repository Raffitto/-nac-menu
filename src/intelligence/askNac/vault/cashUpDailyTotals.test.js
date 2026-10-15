import { getBatchForExportPeriod } from "../../../lib/foodicsApi";
import { processAskNacQuestion } from "../askNacOrchestrator";
import { runVaultQueryTool } from "./vaultQueryTools";
import {
  aggregateCashUpFactsOverRange,
  groupCashUpFactsByBusinessDate,
} from "./vaultCashUpAggregation";

jest.mock("../../../lib/supabase", () => ({
  isSupabaseConfigured: () => true,
}));

jest.mock("../../../lib/foodicsApi", () => ({
  getBatchForExportPeriod: jest.fn(),
  getBatchSalesItems: jest.fn(),
  getImportBatches: jest.fn(),
}));

const COMPANY = { authenticated: true, allBranches: true };
const KHOBAR = {
  authenticated: true,
  allBranches: false,
  branchScope: "khobar",
  allowedBranchIds: ["khobar"],
};

function daily(date, branch, value) {
  return {
    branch_id: branch,
    metric_key: "net_sales",
    metric_value: value,
    period_start: date,
    period_end: date,
    dimensions: {},
    file_version_id: `day-${branch}`,
  };
}

describe("daily Cash Up totals", () => {
  test("a company-wide day is 700 and ignores stale revisions and multi-day rows", () => {
    const date = "2026-10-13";
    const facts = [
      daily(date, "khobar", 100),
      {
        ...daily(date, "khobar", 9999),
        file_version_id: null,
        source_row_ref: "pdf-day-stale",
      },
      daily(date, "riyadh", 200),
      daily(date, "jeddah", 400),
      {
        branch_id: "khobar",
        metric_key: "net_sales",
        metric_value: 100499,
        period_start: "2026-10-01",
        period_end: date,
        dimensions: {},
        file_version_id: "month-summary",
      },
    ];
    const agg = aggregateCashUpFactsOverRange({
      startDate: date,
      endDate: date,
      factsByDate: groupCashUpFactsByBusinessDate(facts),
    });
    expect(agg.totalSales).toBe(700);
    expect(agg.totalSales).not.toBe(9999);
    expect(agg.totalSales).not.toBe(100499);
    expect(agg.dayCount).toBe(1);
    expect(agg.branchesIncluded).toEqual(["khobar", "riyadh", "jeddah"]);
  });

  test("a three-branch seven-day total is 4950, not the 1350 multi-day summaries", () => {
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"];
    const facts = [];
    for (const date of dates) {
      const khobar = date === "2026-09-07" ? 150 : 100;
      facts.push(daily(date, "khobar", khobar), daily(date, "riyadh", 200), daily(date, "jeddah", 400));
    }
    for (const branch of ["khobar", "riyadh", "jeddah"]) {
      facts.push({
        branch_id: branch,
        metric_key: "net_sales",
        metric_value: 450,
        period_start: dates[0],
        period_end: dates[6],
        dimensions: {},
        file_version_id: "range-summary",
      });
    }
    const agg = aggregateCashUpFactsOverRange({
      startDate: dates[0],
      endDate: dates[6],
      factsByDate: groupCashUpFactsByBusinessDate(facts),
    });
    expect(agg.totalSales).toBe(4950);
    expect(agg.totalSales).not.toBe(1350);
    expect(agg.dayCount).toBe(7);
    expect(agg.branchesIncluded).toEqual(["khobar", "riyadh", "jeddah"]);
  });
});

describe("missing Cash Up stays unavailable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBatchForExportPeriod.mockResolvedValue({
      id: "foodics-yesterday",
      branch_id: "khobar",
      period_start: "2026-10-13",
      period_end: "2026-10-13",
    });
  });

  test("the client reports unavailable and does not substitute Foodics", async () => {
    const calls = [];
    const supabase = {
      from(table) {
        calls.push(table);
        const api = {
          select() { return api; },
          eq() { return api; },
          lte() { return api; },
          gte() { return api; },
          neq() { return api; },
          in() { return api; },
          order() { return api; },
          limit() { return api; },
          not() { return api; },
          then(resolve, reject) {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          },
        };
        return api;
      },
    };
    const answer = await processAskNacQuestion({
      question: "sales yesterday",
      supabase,
      profile: COMPANY,
      options: { referenceDate: new Date("2026-10-14T15:00:00+03:00") },
    });
    const text = String(answer.directAnswer || "");
    expect(text).toMatch(/unavailable/i);
    expect(text).toMatch(/Foodics figures are not used|not substituted/i);
    expect(text).not.toMatch(/commerce orders/i);
    expect(calls).not.toContain("commerce_orders");
    expect(getBatchForExportPeriod).not.toHaveBeenCalled();
  });

  test("a Khobar user still cannot read Riyadh Cash Up", async () => {
    const calls = [];
    const supabase = {
      from(table) {
        calls.push(table);
        const api = {
          select() { return api; },
          eq() { return api; },
          lte() { return api; },
          gte() { return api; },
          neq() { return api; },
          in() { return api; },
          order() { return api; },
          limit() { return api; },
          not() { return api; },
          then(resolve, reject) {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          },
        };
        return api;
      },
    };
    const result = await runVaultQueryTool(supabase, "vault_cash_up_summary", {
      question: "Riyadh sales yesterday",
      branchMention: "riyadh",
      profile: KHOBAR,
      vaultPeriod: { startDate: "2026-10-13", endDate: "2026-10-13", isSingleDay: true },
    });
    expect(result.authorizationDenied).toBe(true);
    expect(calls).toEqual([]);
  });
});
