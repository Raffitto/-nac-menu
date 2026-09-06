import { fetchUnifiedOperationalAnalytics } from "./analyticsUnifiedAdapter";

jest.mock("./sessionAnalyticsApi", () => ({
  fetchSessionAnalytics: jest.fn(),
}));
jest.mock("./intelligenceQueryApi", () => ({
  fetchBiDashboard: jest.fn(),
}));
jest.mock("./menuEventsBiFallback", () => ({
  fetchBiItemDetailFromMenuEvents: jest.fn(),
}));

const { fetchSessionAnalytics } = require("./sessionAnalyticsApi");
const { fetchBiDashboard } = require("./intelligenceQueryApi");
const { fetchBiItemDetailFromMenuEvents } = require("./menuEventsBiFallback");

describe("fetchUnifiedOperationalAnalytics Tier-1 path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("runs session + BI in parallel and paints Tier-1 from session first", async () => {
    let releaseBi;
    const biGate = new Promise((resolve) => {
      releaseBi = resolve;
    });

    const partials = [];
    fetchSessionAnalytics.mockImplementation(async () => ({
      aggregates: {
        total_events: 40,
        total_sessions: 7,
        funnel: { qr_scans: 7, item_opens: 12 },
        by_event_type: { qr_session_start: 7 },
        avg_time_spent: 160,
        bounce_sessions: 1,
        deep_sessions: 2,
        session_quality: { bounce: 1, casual: 2, engaged: 3, deep: 1, power: 0 },
      },
      partial: false,
      note: null,
      opsNotes: [],
    }));
    fetchBiDashboard.mockImplementation(async () => {
      await biGate;
      return {
        data: {
          total_events: 40,
          total_sessions: 7,
          funnel: { qr_scans: 7 },
          by_event_type: { qr_session_start: 7 },
        },
        partial: false,
        note: null,
        opsNotes: [],
        liveFallback: false,
        menuDataEmpty: false,
        dataSource: "rpc",
      };
    });

    const done = fetchUnifiedOperationalAnalytics(
      {},
      { selectedRange: "today", timeRangeHours: 24 },
      {
        onTier1Partial: (p) => partials.push(p),
        deferClientPatches: true,
      },
    );

    // Allow session microtask to resolve before BI.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchSessionAnalytics).toHaveBeenCalledWith(
      {},
      expect.any(Object),
      expect.objectContaining({ skipFeed: true, skipLiveQuality: true }),
    );
    expect(fetchBiDashboard).toHaveBeenCalled();
    expect(partials.length).toBeGreaterThanOrEqual(1);
    expect(Number(partials[0].data.total_sessions || partials[0].data.funnel?.qr_scans)).toBeGreaterThan(0);

    releaseBi();
    const full = await done;
    expect(full.data).toBeTruthy();
    expect(fetchBiItemDetailFromMenuEvents).not.toHaveBeenCalled();
  });

  test("does not wait for a hung session RPC when BI is ready", async () => {
    fetchSessionAnalytics.mockImplementation(() => new Promise(() => {}));
    fetchBiDashboard.mockResolvedValue({
      data: {
        total_events: 12,
        total_sessions: 4,
        funnel: { qr_scans: 4 },
        by_event_type: { qr_session_start: 4 },
      },
      partial: false,
      note: null,
      opsNotes: [],
      liveFallback: false,
      menuDataEmpty: false,
      dataSource: "rpc",
    });
    const partials = [];
    const result = await fetchUnifiedOperationalAnalytics(
      {},
      { selectedRange: "today", timeRangeHours: 24 },
      { onTier1Partial: (p) => partials.push(p), deferClientPatches: true },
    );
    expect(Number(result.data?.total_sessions || result.data?.funnel?.qr_scans)).toBeGreaterThan(0);
    expect(partials.some((p) => Number(p.data?.total_sessions || p.data?.funnel?.qr_scans) > 0)).toBe(true);
  }, 4000);
});
