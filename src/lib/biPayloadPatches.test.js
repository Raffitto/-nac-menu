import { MONTH_HOURS } from "../dashboard/utils/rangeState";
import {
  applySessionQualityToAggregates,
  applyLiveSessionQualityFields,
} from "./biPayloadPatches";

jest.mock("./menuEventsBiFallback", () => ({
  fetchBiSessionQualityFromMenuEvents: jest.fn(),
}));

const { fetchBiSessionQualityFromMenuEvents } = require("./menuEventsBiFallback");

const rollupAggregates = {
  total_sessions: 200,
  funnel: { qr_scans: 200, category_opens: 150, item_opens: 80 },
  session_quality: {},
};

const livePatch = {
  total_sessions: 10,
  funnel: { qr_scans: 10, category_opens: 8, item_opens: 5 },
  session_quality: { bounce: 2, casual: 3, engaged: 4, deep: 1, power: 0 },
  bounce_sessions: 2,
  deep_sessions: 1,
  avg_time_spent: 90,
  avg_items_per_session: 1.2,
};

describe("biPayloadPatches month rollup preservation", () => {
  beforeEach(() => {
    fetchBiSessionQualityFromMenuEvents.mockReset();
    fetchBiSessionQualityFromMenuEvents.mockResolvedValue(livePatch);
  });

  test("applySessionQualityToAggregates keeps month rollup sessions when live patch is smaller", async () => {
    const supabase = {};
    const result = await applySessionQualityToAggregates(
      supabase,
      { p_branch: null, p_hours: MONTH_HOURS },
      { ...rollupAggregates },
    );

    expect(result.total_sessions).toBe(200);
    expect(result.funnel.qr_scans).toBe(200);
    expect(result.session_quality.bounce).toBe(2);
    expect(result._sessionMetricsFromLivePatch).toBe(true);
  });

  test("today still allows live patch session totals when rollup is empty", async () => {
    const supabase = {};
    const result = await applySessionQualityToAggregates(
      supabase,
      { p_branch: null, p_hours: 24 },
      { total_sessions: 0, funnel: {} },
    );

    expect(result.total_sessions).toBe(10);
    expect(result.funnel.qr_scans).toBe(10);
  });

  test("applyLiveSessionQualityFields does not change session totals", () => {
    const out = applyLiveSessionQualityFields(rollupAggregates, livePatch);
    expect(out.total_sessions).toBe(200);
    expect(out.funnel.qr_scans).toBe(200);
    expect(out.session_quality.engaged).toBe(4);
  });
});
