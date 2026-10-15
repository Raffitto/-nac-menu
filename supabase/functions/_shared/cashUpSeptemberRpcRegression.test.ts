import assert from "node:assert/strict";
import { buildVaultAnswer, getVaultCashUpFactsOverRange } from "./askNacVaultTools.ts";

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

function septemberEdge() {
  const calls: unknown[] = [];
  return {
    calls,
    from(table: string) {
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
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const data = table === "commerce_orders"
            ? [{ business_date: "2026-09-01", net_sales: 999, covers: 1, branch_id: "khobar" }]
            : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
    rpc(name: string, args: Record<string, unknown>) {
      calls.push(`rpc:${name}`);
      calls.push(args);
      return Promise.resolve({ data: SEPTEMBER, error: null });
    },
  };
}

Deno.test("edge September 2026 Khobar sales use the Cash Up RPC", async () => {
  const supabase = septemberEdge();
  const tool = await getVaultCashUpFactsOverRange(supabase as never, {
    profile: { authenticated: true, allBranches: false, branchScope: "khobar", allowedBranchIds: ["khobar"] },
    question: "What were Khobar's total sales in September 2026?",
    branchMention: "khobar",
    vaultPeriod: {
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      label: "September 2026",
      periodType: "named_month",
    },
  });
  const aggregation = tool.aggregation as {
    totalSales?: number;
    dayCount?: number;
    branchesIncluded?: string[];
    branchCoverageLabel?: string;
    salesSource?: string;
  };
  assert.equal(aggregation.totalSales, 487473.35);
  assert.equal(aggregation.dayCount, 30);
  assert.deepEqual(aggregation.branchesIncluded, ["khobar"]);
  assert.equal(aggregation.branchCoverageLabel, "Khobar");
  assert.equal(aggregation.salesSource, undefined);
  assert.equal(tool.branchLabel, "Khobar");
  assert.equal(supabase.calls.includes("rpc:get_vault_cash_up_range_aggregate"), true);
  assert.equal(supabase.calls.includes("ask_nac_structured_facts"), false);
  assert.equal(supabase.calls.includes("commerce_orders"), false);
  const args = supabase.calls.find((entry) => entry && typeof entry === "object" && "p_start_date" in (entry as object)) as Record<string, unknown>;
  assert.equal(args.p_start_date, "2026-09-01");
  assert.equal(args.p_end_date, "2026-09-30");
  assert.equal(args.p_branch_id, "khobar");
  const answer = buildVaultAnswer(
    {
      intent: "vault_cash_up_summary",
      question: "What were Khobar's total sales in September 2026?",
      salesSource: "cash_up",
      vaultPeriod: { startDate: "2026-09-01", endDate: "2026-09-30", label: "September 2026", periodType: "named_month" },
    },
    tool as Record<string, unknown>,
    { status: "ready", canQuery: true },
  );
  assert.match(String(answer.directAnswer || ""), /487,473\.35/);
  assert.match(String(answer.directAnswer || ""), /Khobar/);
  assert.doesNotMatch(String(answer.directAnswer || ""), /Network/);
  assert.doesNotMatch(String(answer.directAnswer || ""), /commerce orders/i);
});

Deno.test("edge company-wide September with only Khobar data is not labeled Network", async () => {
  const supabase = septemberEdge();
  const tool = await getVaultCashUpFactsOverRange(supabase as never, {
    profile: { authenticated: true, allBranches: true },
    question: "What were total sales in September 2026?",
    vaultPeriod: {
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      label: "September 2026",
      periodType: "named_month",
    },
  });
  assert.equal((tool.aggregation as { totalSales?: number }).totalSales, 487473.35);
  assert.equal((tool.aggregation as { dayCount?: number }).dayCount, 30);
  assert.equal(tool.branchLabel, "Khobar");
  assert.notEqual(tool.branchLabel, "Network");
  assert.equal(supabase.calls.includes("ask_nac_structured_facts"), false);
  assert.equal(supabase.calls.includes("commerce_orders"), false);
});
