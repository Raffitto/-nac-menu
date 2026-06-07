import { fetchAskNacMenuMetrics } from "./askNacMenuMetrics";

jest.mock("../../../lib/intelligenceQueryApi", () => ({
  fetchBiDashboard: jest.fn(),
}));

const { fetchBiDashboard } = require("../../../lib/intelligenceQueryApi");

describe("fetchAskNacMenuMetrics", () => {
  beforeEach(() => {
    fetchBiDashboard.mockReset();
  });

  test("uses hybrid diagnostics from fetchBiDashboard payload", async () => {
    fetchBiDashboard.mockResolvedValue({
      data: {
        data_source: "hybrid",
        funnel: { qr_scans: 55 },
        _mtdHybrid: {
          source: "hybrid",
          includesCurrentBusinessDay: true,
          partialLive: true,
          corrected: true,
          warnings: ["Month-to-date rollup was below live Today for the same metric — applied hybrid MTD correction."],
          rollupMenuQr: 30,
          liveTodayMenuQr: 55,
          hybridMenuQr: 55,
        },
      },
      partial: true,
      note: "Month-to-date combines daily rollup with live Today (hybrid).",
      opsNotes: [],
      dataSource: "hybrid",
    });

    const result = await fetchAskNacMenuMetrics({}, { branch: "khobar", hours: 999 });

    expect(result.menuQrScans).toBe(55);
    expect(result.menuSessions).toBe(55);
    expect(result.mtdHybrid.source).toBe("hybrid");
    expect(result.mtdHybrid.partialLive).toBe(true);
    expect(result.warnings.some((w) => w.includes("hybrid"))).toBe(true);
    expect(result.rpc).toContain("get_bi_dashboard");
  });

  test("today path uses live source without hybrid diagnostics", async () => {
    fetchBiDashboard.mockResolvedValue({
      data: { data_source: "rpc", funnel: { qr_scans: 12 } },
      partial: false,
      opsNotes: [],
      dataSource: "rpc",
    });

    const result = await fetchAskNacMenuMetrics({}, { branch: null, hours: 24 });

    expect(result.menuQrScans).toBe(12);
    expect(result.mtdHybrid.source).toBe("live");
    expect(result.mtdHybrid.partialLive).toBe(false);
  });
});
