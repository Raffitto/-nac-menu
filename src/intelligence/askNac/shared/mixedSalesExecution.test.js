jest.mock("../../../lib/supabase", () => ({
  isSupabaseConfigured: () => true,
}));

jest.mock("../../../lib/foodicsApi", () => ({
  getBatchForExportPeriod: jest.fn(),
  getBatchSalesItems: jest.fn(),
  getImportBatches: jest.fn(),
}));

import { getBatchForExportPeriod, getBatchSalesItems } from "../../../lib/foodicsApi";
import { processAskNacQuestion } from "../askNacOrchestrator";
import { executeMixedTodayYesterdaySales } from "./mixedSalesExecution";
import { getFoodicsSalesSummary } from "../foodics/foodicsQueryTools";
import { runVaultQueryTool } from "../vault/vaultQueryTools";
import { parseVaultPeriodFromQuestion } from "../vault/vaultPeriodParser";

const REF = new Date("2026-10-14T15:00:00+03:00");
const TODAY = "2026-10-14";
const YESTERDAY = "2026-10-13";
const POISON = 555001;

const BRANCHES = [
  { id: "khobar", today: 11101, yesterday: 22201 },
  { id: "riyadh", today: 11102, yesterday: 22202 },
  { id: "jeddah", today: 11103, yesterday: 22203 },
];

function queryApi(resolveData, record) {
  const filters = {};
  const api = {
    select() { return api; },
    eq(column, value) { filters[column] = value; return api; },
    lte(column, value) { filters[`lte:${column}`] = value; return api; },
    gte(column, value) { filters[`gte:${column}`] = value; return api; },
    neq() { return api; },
    in() { return api; },
    order() { return api; },
    limit() { return api; },
    ilike() { return api; },
    or() { return api; },
    filter() { return api; },
    not() { return api; },
    is() { return api; },
    maybeSingle() { return Promise.resolve(resolveData(filters)); },
    single() { return Promise.resolve(resolveData(filters)); },
    then(resolve, reject) {
      record(filters);
      return Promise.resolve(resolveData(filters)).then(resolve, reject);
    },
  };
  return api;
}

function supabaseFor(branch) {
  const cashUpWindows = [];
  const client = {
    cashUpWindows,
    from(table) {
      return queryApi((filters) => {
        if (table !== "ask_nac_structured_facts") return { data: [], error: null };
        const start = filters["gte:period_end"];
        const end = filters["lte:period_start"];
        if (start === TODAY || end === TODAY) {
          return {
            data: [{
              id: "poison",
              branch_id: branch.id,
              report_type: "cash_up",
              metric_key: "net_sales",
              metric_value: POISON,
              period_start: TODAY,
              period_end: TODAY,
              file: { title: "today.xlsx" },
            }],
            error: null,
          };
        }
        if (start === YESTERDAY && end === YESTERDAY) {
          return {
            data: [{
              id: "yesterday",
              branch_id: branch.id,
              report_type: "cash_up",
              metric_key: "net_sales",
              metric_value: branch.yesterday,
              period_start: YESTERDAY,
              period_end: YESTERDAY,
              file: { title: "yesterday.xlsx" },
            }],
            error: null,
          };
        }
        return { data: [], error: null };
      }, (filters) => {
        if (table === "ask_nac_structured_facts" && filters["gte:period_end"]) {
          cashUpWindows.push({
            start: filters["gte:period_end"],
            end: filters["lte:period_start"],
            branchId: filters.branch_id || null,
          });
        }
      });
    },
  };
  return client;
}

function shows(text, value) {
  return text.includes(String(value)) || text.includes(Number(value).toLocaleString("en-US"));
}

describe("mixed today versus yesterday execution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(BRANCHES)("retrieves Foodics today and Cash Up yesterday for $id", async (branch) => {
    const foodicsWindows = [];
    getBatchForExportPeriod.mockImplementation(async (_type, _branchId, startDate, endDate) => {
      foodicsWindows.push({ startDate, endDate });
      if (startDate !== TODAY || endDate !== TODAY) return null;
      return {
        id: `batch-${branch.id}`,
        branch_id: branch.id,
        period_start: TODAY,
        period_end: TODAY,
        source_file_name: "synthetic-today.xlsx",
      };
    });
    getBatchSalesItems.mockResolvedValue([{
      raw_item_name: "Synthetic plate",
      matched_menu_item_name: "Synthetic plate",
      category: "Food",
      analytics_category: "Food",
      quantity_sold: 4,
      net_sales: branch.today,
      gross_sales: branch.today,
    }]);

    const supabase = supabaseFor(branch);
    const answer = await processAskNacQuestion({
      question: "Compare sales today vs yesterday",
      supabase,
      profile: { authenticated: true, allBranches: true },
      filters: { branch: branch.id },
      options: { referenceDate: REF },
    });

    const text = String(answer.directAnswer || "");
    expect(shows(text, branch.today)).toBe(true);
    expect(shows(text, branch.yesterday)).toBe(true);
    expect(text).toContain(TODAY);
    expect(text).toContain(YESTERDAY);
    expect(text).toMatch(/Foodics operational\/live/);
    expect(text).toMatch(/Cash Up/);
    expect(text).toMatch(/not be directly comparable|not added together/i);
    expect(shows(text, branch.today + branch.yesterday)).toBe(false);
    expect(text).not.toContain(String(POISON));
    expect(foodicsWindows.some((window) => window.startDate === TODAY && window.endDate === TODAY)).toBe(true);
    expect(foodicsWindows.some((window) => window.startDate === YESTERDAY)).toBe(false);
    expect(supabase.cashUpWindows.some((window) => window.start === YESTERDAY && window.end === YESTERDAY)).toBe(true);
    expect(supabase.cashUpWindows.some((window) => window.start === TODAY || window.end === TODAY)).toBe(false);
  });

  test("names the missing side and does not substitute the other figure", async () => {
    getBatchForExportPeriod.mockResolvedValue(null);
    getBatchSalesItems.mockResolvedValue([]);
    const branch = BRANCHES[0];
    const missingFoodics = await processAskNacQuestion({
      question: "Compare sales today vs yesterday",
      supabase: supabaseFor(branch),
      profile: { authenticated: true, allBranches: true },
      filters: { branch: branch.id },
      options: { referenceDate: REF },
    });
    const missingFoodicsText = String(missingFoodics.directAnswer || "");
    expect(missingFoodicsText).toMatch(/Foodics operational\/live sales are unavailable/);
    expect(missingFoodicsText).toMatch(/No figure was substituted/);
    expect(shows(missingFoodicsText, branch.yesterday)).toBe(true);
    expect(shows(missingFoodicsText, branch.today)).toBe(false);

    getBatchForExportPeriod.mockImplementation(async () => ({
      id: "batch-today",
      branch_id: branch.id,
      period_start: TODAY,
      period_end: TODAY,
      source_file_name: "synthetic-today.xlsx",
    }));
    getBatchSalesItems.mockResolvedValue([{
      raw_item_name: "Synthetic plate",
      matched_menu_item_name: "Synthetic plate",
      quantity_sold: 1,
      net_sales: branch.today,
      gross_sales: branch.today,
    }]);
    const emptyCashUp = {
      from() {
        return queryApi(() => ({ data: [], error: null }), () => {});
      },
    };
    const missingCashUp = await processAskNacQuestion({
      question: "Compare sales today vs yesterday",
      supabase: emptyCashUp,
      profile: { authenticated: true, allBranches: true },
      filters: { branch: branch.id },
      options: { referenceDate: REF },
    });
    const missingCashUpText = String(missingCashUp.directAnswer || "");
    expect(missingCashUpText).toMatch(/official Cash Up is unavailable/);
    expect(missingCashUpText).toMatch(/not substituted/);
    expect(shows(missingCashUpText, branch.today)).toBe(true);
    expect(shows(missingCashUpText, branch.yesterday)).toBe(false);
  });

  test("yesterday stays the calendar day before 08:00 Asia/Riyadh", async () => {
    const early = new Date("2026-10-14T07:00:00+03:00");
    getBatchForExportPeriod.mockImplementation(async (_type, _branchId, startDate, endDate) => {
      expect(startDate).toBe(TODAY);
      expect(endDate).toBe(TODAY);
      return null;
    });
    const windows = [];
    const supabase = {
      from(table) {
        return queryApi((filters) => {
          if (table === "ask_nac_structured_facts") {
            windows.push({ start: filters["gte:period_end"], end: filters["lte:period_start"] });
          }
          return { data: [], error: null };
        }, () => {});
      },
    };
    await processAskNacQuestion({
      question: "Compare sales today vs yesterday",
      supabase,
      profile: { authenticated: true, allBranches: true },
      filters: { branch: "khobar" },
      options: { referenceDate: early },
    });
    expect(windows.some((window) => window.start === YESTERDAY && window.end === YESTERDAY)).toBe(true);
    expect(windows.some((window) => window.start === "2026-10-12" || window.end === "2026-10-12")).toBe(false);
  });
});

const KHOBAR_ONLY = { authenticated: true, allBranches: false, branchScope: "khobar", allowedBranchIds: ["khobar"] };
const RIYADH_ONLY = { authenticated: true, allBranches: false, branchScope: "riyadh", allowedBranchIds: ["riyadh"] };

function countingSupabase() {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      return queryApi(() => ({ data: [], error: null }), () => {});
    },
  };
}

describe("operational sales authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("a Khobar user is denied Riyadh mixed sales before either source is queried", async () => {
    const supabase = countingSupabase();
    const result = await executeMixedTodayYesterdaySales(supabase, {
      question: "Riyadh sales today vs yesterday",
      branchMention: "riyadh",
      profile: KHOBAR_ONLY,
      referenceDate: REF,
    });
    expect(result.authorizationDenied).toBe(true);
    expect(result.deniedBranch).toBe("riyadh");
    expect(getBatchForExportPeriod).not.toHaveBeenCalled();
    expect(supabase.calls).toEqual([]);
  });

  test("a Riyadh user is denied Khobar mixed sales before either source is queried", async () => {
    const supabase = countingSupabase();
    const result = await executeMixedTodayYesterdaySales(supabase, {
      question: "Khobar sales today vs yesterday",
      branchMention: "khobar",
      profile: RIYADH_ONLY,
      referenceDate: REF,
    });
    expect(result.authorizationDenied).toBe(true);
    expect(result.deniedBranch).toBe("khobar");
    expect(getBatchForExportPeriod).not.toHaveBeenCalled();
    expect(supabase.calls).toEqual([]);
  });

  test("company-wide access can query a named branch", async () => {
    getBatchForExportPeriod.mockResolvedValue(null);
    await executeMixedTodayYesterdaySales(countingSupabase(), {
      question: "Riyadh sales today vs yesterday",
      branchMention: "riyadh",
      profile: { authenticated: true, allBranches: true },
      referenceDate: REF,
    });
    expect(getBatchForExportPeriod).toHaveBeenCalled();
  });

  test("single-source Foodics and Cash Up deny a foreign branch before querying", async () => {
    const supabase = countingSupabase();
    const foodics = await getFoodicsSalesSummary(supabase, {
      question: "Riyadh sales today",
      branchMention: "riyadh",
      profile: KHOBAR_ONLY,
      foodicsPeriod: { startDate: TODAY, endDate: TODAY },
    });
    const cashUp = await runVaultQueryTool(supabase, "vault_cash_up_summary", {
      question: "Riyadh sales yesterday",
      branchMention: "riyadh",
      profile: KHOBAR_ONLY,
      vaultPeriod: { startDate: YESTERDAY, endDate: YESTERDAY, isSingleDay: true },
    });
    expect(foodics.authorizationDenied).toBe(true);
    expect(cashUp.authorizationDenied).toBe(true);
    expect(getBatchForExportPeriod).not.toHaveBeenCalled();
    expect(supabase.calls).toEqual([]);
  });

  test("Khobar sales are labeled Khobar and are not a company total", async () => {
    getBatchForExportPeriod.mockResolvedValue({
      id: "batch-khobar",
      branch_id: "khobar",
      period_start: TODAY,
      period_end: TODAY,
    });
    getBatchSalesItems.mockResolvedValue([{ net_sales: 11101, quantity_sold: 1, raw_item_name: "Synthetic plate" }]);
    const answer = await processAskNacQuestion({
      question: "Compare sales today vs yesterday",
      supabase: supabaseFor(BRANCHES[0]),
      profile: KHOBAR_ONLY,
      options: { referenceDate: REF },
    });
    const text = String(answer.directAnswer || "");
    expect(text).toMatch(/Khobar/);
    expect(text).toMatch(/not a company total/);
    expect(text).not.toMatch(/Riyadh/);
    expect(text).not.toMatch(/Jeddah/);
    expect(shows(text, 11101)).toBe(true);
  });

  test("a company-wide question does not present Khobar as the company total when other branches are unavailable", async () => {
    getBatchForExportPeriod.mockImplementation(async (_type, branchId) => {
      if (branchId !== "khobar") return null;
      return { id: "batch-khobar", branch_id: "khobar", period_start: TODAY, period_end: TODAY };
    });
    getBatchSalesItems.mockResolvedValue([{ net_sales: 11101, quantity_sold: 1, raw_item_name: "Synthetic plate" }]);
    const supabase = {
      from(table) {
        return queryApi((filters) => {
          if (table !== "ask_nac_structured_facts" || filters.branch_id !== "khobar") return { data: [], error: null };
          if (filters["gte:period_end"] !== YESTERDAY) return { data: [], error: null };
          return {
            data: [{
              branch_id: "khobar",
              report_type: "cash_up",
              metric_key: "net_sales",
              metric_value: 22201,
              period_start: YESTERDAY,
              period_end: YESTERDAY,
            }],
            error: null,
          };
        }, () => {});
      },
    };
    const answer = await processAskNacQuestion({
      question: "Compare sales today vs yesterday",
      supabase,
      profile: { authenticated: true, allBranches: true },
      options: { referenceDate: REF },
    });
    const text = String(answer.directAnswer || "");
    expect(text).toMatch(/Khobar/);
    expect(text).toMatch(/Riyadh unavailable/);
    expect(text).toMatch(/Jeddah unavailable/);
    expect(text).toMatch(/coverage is incomplete/);
    expect(text).not.toMatch(/Company Foodics operational\/live total: 11,101/);
    expect(text).not.toMatch(/Company official Cash Up total: 22,201/);
  });

  test.each([
    ["Compare sales this week vs last week", "this week", "last week"],
    ["Compare sales this month vs last month", "this month", "last month"],
  ])("%s uses Foodics for the open period and Cash Up for the completed period", async (question, currentToken, previousToken) => {
    const current = parseVaultPeriodFromQuestion(currentToken, REF);
    const previous = parseVaultPeriodFromQuestion(previousToken, REF);
    const foodicsWindows = [];
    const cashUpWindows = [];
    getBatchForExportPeriod.mockImplementation(async (_type, _branch, startDate, endDate) => {
      foodicsWindows.push({ startDate, endDate });
      return null;
    });
    const supabase = {
      from() {
        return queryApi((filters) => {
          if (filters["gte:period_end"]) {
            cashUpWindows.push({ start: filters["gte:period_end"], end: filters["lte:period_start"] });
          }
          return { data: [], error: null };
        }, () => {});
      },
    };
    const answer = await processAskNacQuestion({
      question,
      supabase,
      profile: KHOBAR_ONLY,
      options: { referenceDate: REF },
    });
    expect(foodicsWindows).toEqual([{ startDate: current.startDate, endDate: current.endDate }]);
    expect(cashUpWindows).toEqual([{ start: previous.startDate, end: previous.endDate }]);
    const text = String(answer.directAnswer || "");
    expect(text).toMatch(/Foodics operational\/live/);
    expect(text).toMatch(/Cash Up/);
    expect(text).toMatch(/not added together/);
    expect(text).toMatch(/Khobar/);
  });

  test("an explicit Foodics comparison uses Foodics for both periods", async () => {
    const foodicsWindows = [];
    getBatchForExportPeriod.mockImplementation(async (_type, _branch, startDate, endDate) => {
      foodicsWindows.push({ startDate, endDate });
      return {
        id: `batch-${startDate}`,
        branch_id: "khobar",
        period_start: startDate,
        period_end: endDate,
      };
    });
    getBatchSalesItems.mockImplementation(async () => [{ net_sales: 11101, quantity_sold: 1, raw_item_name: "Synthetic plate" }]);
    const supabase = countingSupabase();
    const answer = await processAskNacQuestion({
      question: "Compare Foodics sales today vs yesterday",
      supabase,
      profile: KHOBAR_ONLY,
      options: { referenceDate: REF },
    });
    expect(foodicsWindows).toEqual([
      { startDate: TODAY, endDate: TODAY },
      { startDate: YESTERDAY, endDate: YESTERDAY },
    ]);
    expect(supabase.calls).toEqual([]);
    expect(String(answer.directAnswer || "")).toMatch(/Foodics/);
    expect(String(answer.directAnswer || "")).not.toMatch(/Cash Up/);
  });
});
