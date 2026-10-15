import { executeMixedTodayYesterdaySales } from "./mixedSalesExecution.ts";
import { runVaultQueryTool } from "./askNacVaultTools.ts";

function fakeSupabase(windows: Array<{ start: string | undefined; end: string | undefined }>) {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const api = {
        select() { return api; },
        eq() { return api; },
        lte(column: string, value: string) { filters[`lte:${column}`] = value; return api; },
        gte(column: string, value: string) { filters[`gte:${column}`] = value; return api; },
        neq() { return api; },
        in() { return api; },
        order() { return api; },
        limit() { return api; },
        then(resolve: (value: { data: unknown[]; error: null }) => void) {
          if (table === "ask_nac_structured_facts") {
            windows.push({ start: filters["gte:period_end"], end: filters["lte:period_start"] });
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return api;
    },
  };
}

Deno.test("mixed Cash Up query uses yesterday even when the question says today", async () => {
  const windows: Array<{ start: string | undefined; end: string | undefined }> = [];
  await runVaultQueryTool(fakeSupabase(windows) as never, "vault_cash_up_summary", {
    question: "Compare sales today vs yesterday",
    mixedSalesSide: "yesterday",
    profile: { authenticated: true, allBranches: true },
    referenceDate: new Date("2026-10-14T15:00:00+03:00"),
  });
  if (!windows.some((window) => window.start === "2026-10-13" && window.end === "2026-10-13")) {
    throw new Error(`expected yesterday window, got ${JSON.stringify(windows)}`);
  }
  if (windows.some((window) => window.start === "2026-10-14" || window.end === "2026-10-14")) {
    throw new Error(`Cash Up queried today: ${JSON.stringify(windows)}`);
  }
});

Deno.test("a Khobar profile does not query Riyadh Foodics or Cash Up", async () => {
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
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolve: (value: { data: unknown[]; error: null }) => void) {
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return api;
    },
  };
  const result = await executeMixedTodayYesterdaySales(supabase as never, {
    question: "Riyadh sales today vs yesterday",
    branchMention: "riyadh",
    profile: { authenticated: true, allBranches: false, branchScope: "khobar", allowedBranchIds: ["khobar"] },
    referenceDate: new Date("2026-10-14T15:00:00+03:00"),
  });
  if (!result.authorizationDenied) throw new Error("expected denial");
  if (calls.length !== 0) throw new Error(`unauthorized query: ${calls.join(",")}`);
});
