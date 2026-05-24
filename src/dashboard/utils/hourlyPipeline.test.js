import {
  resolveChartGranularityForHours,
  normalizeHourlyForRange,
  buildHourlyChartData,
} from "./hourlyPipeline";

describe("hourlyPipeline", () => {
  test("Today uses 24 hourly buckets", () => {
    expect(resolveChartGranularityForHours(24)).toBe("hour");
    const normalized = normalizeHourlyForRange(
      [{ hour: 14, count: 5, granularity: "hour" }],
      24,
    );
    expect(normalized).toHaveLength(24);
    expect(normalized.find((r) => r.hour === 14)?.count).toBe(5);
    expect(normalized.find((r) => r.hour === 3)?.count).toBe(0);
  });

  test("7D uses daily buckets", () => {
    expect(resolveChartGranularityForHours(168)).toBe("day");
    const { rows, granularity } = buildHourlyChartData(
      [{ hour: "2026-05-20", count: 12, granularity: "day" }],
      168,
    );
    expect(granularity).toBe("day");
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.some((r) => String(r.label).includes("May"))).toBe(true);
  });

  test("Today chart uses hour labels even if RPC returns a daily bucket", () => {
    const { rows, granularity } = buildHourlyChartData(
      [{ hour: "2026-05-24", count: 99, granularity: "day" }],
      24,
    );
    expect(granularity).toBe("hour");
    expect(rows).toHaveLength(24);
    expect(rows.every((r) => /^\d{2}:\d{2}$/.test(r.label))).toBe(true);
  });
});
