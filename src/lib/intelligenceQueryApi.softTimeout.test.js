import { BI_TODAY_SOFT_TIMEOUT_MS, fetchBiDashboard } from "./intelligenceQueryApi";

jest.mock("./menuEventsBiFallback", () => ({
  fetchBiFromMenuEvents: jest.fn().mockResolvedValue(null),
  fetchBiItemDetailFromMenuEvents: jest.fn().mockResolvedValue(null),
  normalizeBranchForRpc: (b) => b || null,
}));

jest.mock("./mtdHybridMerge", () => ({
  isMonthRangeHours: () => false,
  hydrateMonthToDateHybrid: jest.fn(),
}));

describe("fetchBiDashboard soft timeout", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  test("exports a sub-3s Today soft timeout", () => {
    expect(BI_TODAY_SOFT_TIMEOUT_MS).toBeGreaterThanOrEqual(1500);
    expect(BI_TODAY_SOFT_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });

  test("ordinary Today load uses the rollup and never calls get_bi_dashboard", async () => {
    const supabase = {
      rpc: jest.fn((name) => {
        if (name === "get_bi_dashboard") {
          return new Promise(() => {});
        }
        if (name === "get_bi_dashboard_from_rollup") {
          return Promise.resolve({
            data: {
              total_events: 20,
              total_sessions: 5,
              funnel: { qr_scans: 5 },
              by_event_type: { qr_session_start: 5 },
              by_hour: [],
              top_items: [],
              top_categories: [],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const result = await fetchBiDashboard(supabase, {
      branch: null,
      hours: 24,
      deferClientPatches: true,
      forceLiveBi: true,
    });

    expect(supabase.rpc).not.toHaveBeenCalledWith("get_bi_dashboard", expect.any(Object));
    expect(supabase.rpc).toHaveBeenCalledWith(
      "get_bi_dashboard_from_rollup",
      expect.any(Object),
    );
    expect(Number(result.data?.total_sessions || result.data?.funnel?.qr_scans)).toBe(5);
  });

  test("skipLiveBi uses rollup only and never calls get_bi_dashboard", async () => {
    const supabase = {
      rpc: jest.fn((name) => {
        if (name === "get_bi_dashboard_from_rollup") {
          return Promise.resolve({
            data: {
              total_events: 9,
              total_sessions: 3,
              funnel: { qr_scans: 3 },
              by_event_type: { qr_session_start: 3 },
              by_hour: [],
              top_items: [],
              top_categories: [],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const result = await fetchBiDashboard(supabase, {
      branch: "khobar",
      hours: 24,
      skipLiveBi: true,
      deferClientPatches: true,
    });

    expect(supabase.rpc).toHaveBeenCalledWith("get_bi_dashboard_from_rollup", expect.any(Object));
    expect(supabase.rpc).not.toHaveBeenCalledWith("get_bi_dashboard", expect.any(Object));
    expect(Number(result.data?.total_sessions || result.data?.funnel?.qr_scans)).toBe(3);
  });

  test("a stalled today rollup settles instead of hanging the dashboard", async () => {
    const supabase = {
      rpc: jest.fn((name) => {
        if (name === "get_bi_dashboard_from_rollup") return new Promise(() => {});
        return Promise.resolve({ data: null, error: null });
      }),
    };

    await expect(
      fetchBiDashboard(supabase, {
        branch: null,
        hours: 24,
        skipLiveBi: true,
        deferClientPatches: true,
        softTimeoutMs: 30,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/timeout/i) });

    const rollupCalls = supabase.rpc.mock.calls.filter(
      (call) => call[0] === "get_bi_dashboard_from_rollup",
    );
    expect(rollupCalls).toHaveLength(1);
    expect(supabase.rpc).not.toHaveBeenCalledWith("get_bi_dashboard", expect.any(Object));
  });
});

