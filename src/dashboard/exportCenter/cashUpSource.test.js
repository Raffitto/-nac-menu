import { cashUpBusinessDate, fetchCanonicalCashUpForExport } from "./cashUpSource";

describe("canonical Cash Up source", () => {
  test("resolves business date from period_end or period_start", () => {
    expect(cashUpBusinessDate({ period_end: "2026-08-12T00:00:00.000Z" })).toBe("2026-08-12");
    expect(cashUpBusinessDate({ period_start: "2026-08-13" })).toBe("2026-08-13");
  });

  test("uses Ask NAC Vault RPC daily breakdown for coverage dates", async () => {
    const supabase = {
      auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
      rpc: async () => ({
        data: {
          dayCount: 2,
          dailyBreakdown: [
            { date: "2026-08-01", totalSales: 100 },
            { date: "2026-08-02", totalSales: 200 },
          ],
        },
        error: null,
      }),
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          lte: () => q,
          gte: () => q,
          is: () => q,
          order: () => q,
          range: async () => ({ data: [], error: null }),
        };
        return q;
      },
    };
    const result = await fetchCanonicalCashUpForExport(supabase, {
      branch: "khobar",
      from: "2026-08-01",
      to: "2026-08-02",
    });
    expect(result.cashUpDates).toEqual(["2026-08-01", "2026-08-02"]);
    expect(result.facts.some((f) => f.metric_key === "total_sales" && f.period_end === "2026-08-01")).toBe(true);
    expect(result.error).toBeNull();
  });
});
