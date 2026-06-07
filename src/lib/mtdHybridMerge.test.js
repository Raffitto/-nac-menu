import {
  mergeMonthToDateHybrid,
  applyHybridMetricsToPayload,
  extractCanonicalQrMetrics,
  extractRollupTodayQrPortion,
  assertMtdTodayInvariant,
  isMonthRangeHours,
} from "./mtdHybridMerge";

describe("mtdHybridMerge", () => {
  test("Today live 50, stale MTD rollup 30 → final MTD at least 50", () => {
    const result = mergeMonthToDateHybrid({
      rollupPayload: { funnel: { qr_scans: 30 }, total_sessions: 30 },
      liveTodayPayload: { funnel: { qr_scans: 50 }, total_sessions: 50 },
    });
    expect(result.hybridMenuQr).toBeGreaterThanOrEqual(50);
    expect(assertMtdTodayInvariant(
      { menuQrScans: result.hybridMenuQr },
      { menuQrScans: 50 },
    ).ok).toBe(true);
  });

  test("closed rollup 100 + live today 50 → MTD 150 when today not in rollup", () => {
    const result = mergeMonthToDateHybrid({
      rollupPayload: { funnel: { qr_scans: 100 }, total_sessions: 100, today_qr_sessions: 0 },
      liveTodayPayload: { funnel: { qr_scans: 50 }, total_sessions: 50 },
    });
    expect(result.hybridMenuQr).toBe(150);
  });

  test("rollup includes today 50 in 150 total, live today 50 → MTD stays 150 not 200", () => {
    const result = mergeMonthToDateHybrid({
      rollupPayload: {
        funnel: { qr_scans: 150 },
        total_sessions: 150,
        today_qr_sessions: 50,
      },
      liveTodayPayload: { funnel: { qr_scans: 50 }, total_sessions: 50 },
    });
    expect(result.hybridMenuQr).toBe(150);
    expect(result.closedDaysQr).toBe(100);
  });

  test("rollup today portion extracted from by_hour business day bucket", () => {
    const portion = extractRollupTodayQrPortion(
      {
        by_hour: [{ business_day_key: "2026-06-06", count: 42, granularity: "day" }],
        funnel: { qr_scans: 200 },
      },
      "2026-06-06",
    );
    expect(portion).toBe(42);
  });

  test("applyHybridMetricsToPayload sets diagnostics", () => {
    const merged = applyHybridMetricsToPayload(
      { funnel: { qr_scans: 30, category_opens: 20 } },
      mergeMonthToDateHybrid({
        rollupPayload: { funnel: { qr_scans: 30 } },
        liveTodayPayload: { funnel: { qr_scans: 50 } },
      }),
    );
    expect(merged._mtdHybrid.source).toBe("hybrid");
    expect(merged.funnel.qr_scans).toBeGreaterThanOrEqual(50);
    expect(merged.menu_qr_scans).toBe(merged.funnel.qr_scans);
  });

  test("isMonthRangeHours identifies MTD", () => {
    expect(isMonthRangeHours(999)).toBe(true);
    expect(isMonthRangeHours(24)).toBe(false);
  });

  test("extractCanonicalQrMetrics prefers funnel qr over inflated total_sessions", () => {
    const m = extractCanonicalQrMetrics({
      total_sessions: 224,
      funnel: { qr_scans: 4 },
    });
    expect(m.menuQrScans).toBe(4);
    expect(m.sessions).toBe(4);
  });

  test("business day key before 03:00 Riyadh rolls to previous calendar day", () => {
    const { getBusinessDayKey } = require("../dashboard/utils/businessDay");
    const key = getBusinessDayKey(new Date("2026-06-06T00:30:00+03:00"));
    expect(key).toBe("2026-06-05");
  });
});
