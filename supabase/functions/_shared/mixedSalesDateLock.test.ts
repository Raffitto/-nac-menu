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
    referenceDate: new Date("2026-10-14T15:00:00+03:00"),
  });
  if (!windows.some((window) => window.start === "2026-10-13" && window.end === "2026-10-13")) {
    throw new Error(`expected yesterday window, got ${JSON.stringify(windows)}`);
  }
  if (windows.some((window) => window.start === "2026-10-14" || window.end === "2026-10-14")) {
    throw new Error(`Cash Up queried today: ${JSON.stringify(windows)}`);
  }
});
