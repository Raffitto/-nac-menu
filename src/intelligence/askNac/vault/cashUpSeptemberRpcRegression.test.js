import { getBatchForExportPeriod } from "../../../lib/foodicsApi";
import { processAskNacQuestion } from "../askNacOrchestrator";
import { getVaultCashUpFactsOverRange } from "./vaultQueryTools";

jest.mock("../../../lib/supabase", () => ({
  isSupabaseConfigured: () => true,
}));

jest.mock("../../../lib/foodicsApi", () => ({
  getBatchForExportPeriod: jest.fn(),
  getBatchSalesItems: jest.fn(),
  getImportBatches: jest.fn(),
}));

const SEPTEMBER = {
  totalSales: 487473.35,
  totalGuests: 12000,
  totalOrders: 9000,
  averageSpend: 487473.35 / 12000,
  dayCount: 30,
  salesCoverageStart: "2026-09-01",
  salesCoverageEnd: "2026-09-30",
  branchesIncluded: ["khobar"],
  dailyBreakdown: [],
  deliveryPlatformBreakdown: {},
};

const COMPANY = { authenticated: true, allBranches: true };
const KHOBAR = {
  authenticated: true,
  allBranches: false,
  branchScope: "khobar",
  allowedBranchIds: ["khobar"],
};

function septemberClient() {
  const calls = [];
  return {
    calls,
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
          const data = table === "ask_nac_data_coverage"
            ? [{
              id: "coverage-khobar-september",
              branch_id: "khobar",
              report_type: "cash_up",
              period_start: "2026-09-01",
              period_end: "2026-09-30",
              fact_count: 30,
              readiness_status: "ready",
            }]
            : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
    rpc(name, args) {
      calls.push(`rpc:${name}`);
      calls.push(args);
      return Promise.resolve({ data: SEPTEMBER, error: null });
    },
  };
}

describe("Khobar September 2026 Cash Up RPC", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBatchForExportPeriod.mockResolvedValue({
      id: "foodics-should-not-be-used",
      branch_id: "khobar",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
    });
  });

  test("the client uses the RPC for the 30-day month and labels Khobar", async () => {
    const supabase = septemberClient();
    const answer = await processAskNacQuestion({
      question: "What were Khobar's total sales in September 2026?",
      supabase,
      profile: KHOBAR,
      options: { referenceDate: new Date("2026-10-14T15:00:00+03:00") },
    });
    const text = String(answer.directAnswer || "");
    expect(text).toMatch(/487,473\.35/);
    expect(text).toMatch(/Khobar/);
    expect(text).not.toMatch(/Network/);
    expect(text).not.toMatch(/commerce orders/i);
    expect(text).not.toMatch(/Foodics operational\/live sales:/);
    expect(supabase.calls).toContain("rpc:get_vault_cash_up_range_aggregate");
    const rpcIndex = supabase.calls.indexOf("rpc:get_vault_cash_up_range_aggregate");
    const factIndex = supabase.calls.indexOf("ask_nac_structured_facts");
    expect(rpcIndex).toBeGreaterThanOrEqual(0);
    expect(factIndex === -1 || rpcIndex < factIndex).toBe(true);
    expect(supabase.calls).not.toContain("commerce_orders");
    expect(getBatchForExportPeriod).not.toHaveBeenCalled();
    const rpcArgs = supabase.calls.find((entry) => entry && entry.p_start_date);
    expect(rpcArgs).toMatchObject({
      p_start_date: "2026-09-01",
      p_end_date: "2026-09-30",
      p_branch_id: "khobar",
    });
  });

  test("a company-wide September read with only Khobar Cash Up is labeled Khobar", async () => {
    const supabase = septemberClient();
    const result = await getVaultCashUpFactsOverRange(supabase, {
      profile: COMPANY,
      question: "What were total sales in September 2026?",
      vaultPeriod: {
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        label: "September 2026",
        periodType: "named_month",
      },
    });
    expect(result.aggregation.totalSales).toBe(487473.35);
    expect(result.aggregation.dayCount).toBe(30);
    expect(result.aggregation.branchesIncluded).toEqual(["khobar"]);
    expect(result.aggregation.branchCoverageLabel).toBe("Khobar");
    expect(result.branchLabel).toBe("Khobar");
    expect(result.branchLabel).not.toBe("Network");
    expect(supabase.calls).toContain("rpc:get_vault_cash_up_range_aggregate");
    expect(supabase.calls).not.toContain("ask_nac_structured_facts");
    expect(supabase.calls).not.toContain("commerce_orders");
  });
});
