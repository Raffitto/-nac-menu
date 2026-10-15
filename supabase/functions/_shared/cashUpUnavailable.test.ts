import assert from "node:assert/strict";
import { buildVaultAnswer, getVaultCashUpFactsOverRange } from "./askNacVaultTools.ts";

Deno.test("edge Cash Up does not substitute commerce orders when the period is missing", async () => {
  const calls: string[] = [];
  const supabase = {
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
            ? [{ business_date: "2026-10-13", net_sales: 999, covers: 4, branch_id: "khobar" }]
            : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
    rpc() {
      calls.push("rpc");
      return Promise.resolve({ data: null, error: { message: "rpc unavailable" } });
    },
  };
  const tool = await getVaultCashUpFactsOverRange(supabase as never, {
    profile: { authenticated: true, allBranches: true },
    question: "sales yesterday",
    vaultPeriod: {
      startDate: "2026-10-13",
      endDate: "2026-10-13",
      label: "13 October 2026",
      isSingleDay: true,
    },
  });
  assert.equal(calls.includes("commerce_orders"), false);
  assert.equal((tool.aggregation as { salesSource?: string } | null)?.salesSource, undefined);
  assert.equal((tool.aggregation as { dayCount?: number } | null)?.dayCount, 0);
  const answer = buildVaultAnswer(
    {
      intent: "vault_cash_up_summary",
      question: "sales yesterday",
      salesSource: "cash_up",
      vaultPeriod: { startDate: "2026-10-13", endDate: "2026-10-13", label: "13 October 2026" },
    },
    tool as Record<string, unknown>,
    { status: "ready", canQuery: true },
  );
  assert.match(String(answer.directAnswer || ""), /unavailable/i);
  assert.doesNotMatch(String(answer.directAnswer || ""), /commerce orders/i);
  assert.doesNotMatch(String(answer.directAnswer || ""), /999/);
});
