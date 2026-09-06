import {
  buildTemporalCoverage,
  spokenPeriodLabel,
  applySpokenPeriodToAnswer,
  coverageFromCashUpAggregation,
  sanitizeIncompletePeriodAnswer,
  COVERAGE_STATUS,
  riyadhYmd,
  latestCompletedBusinessDate,
} from "./temporalCoverage";

const SEP6 = new Date("2026-09-06T19:00:00+03:00");

describe("Ask NAC temporal coverage", () => {
  test("Asia/Riyadh today on Sep 6 evening is 2026-09-06", () => {
    expect(riyadhYmd(SEP6)).toBe("2026-09-06");
    expect(latestCompletedBusinessDate(SEP6)).toBe("2026-09-05");
  });

  test("Sep 6 this-week reproduction: do not speak Sunday 6 Sep as included", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-08-31",
      requestedEnd: "2026-09-06",
      requestedLabel: "Monday, 31 August – Sunday, 6 September",
      availableDates: ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"],
      latestAvailableDate: "2026-09-05",
      referenceDate: SEP6,
      source: "cash_up",
    });
    expect(coverage.coverageStatus).toBe(COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE);
    expect(coverage.missingDates).toEqual(["2026-09-06"]);
    expect(spokenPeriodLabel(coverage, { weekish: true })).toMatch(/so far this week through 5 Sep 2026/i);

    const bad = "For Khobar in Monday, 31 August – Sunday, 6 September, net sales were SAR 106224.3.";
    const fixed = applySpokenPeriodToAnswer(bad, coverage, { weekish: true });
    expect(fixed).toMatch(/so far this week through 5 Sep 2026/i);
    expect(fixed).toMatch(/6 Sep 2026 does not have sales data yet/i);
    expect(fixed).not.toMatch(/For Khobar in Monday, 31 August – Sunday, 6 September/);
    expect(fixed).toMatch(/106224/);
  });

  test("today without data is current-day-not-complete when latest exists", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-09-06",
      requestedEnd: "2026-09-06",
      requestedLabel: "6 September 2026",
      availableDates: [],
      latestAvailableDate: "2026-09-05",
      referenceDate: SEP6,
    });
    expect(coverage.coverageStatus).toBe(COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE);
    expect(coverage.missingDates).toEqual(["2026-09-06"]);
  });

  test("yesterday complete", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-09-05",
      requestedEnd: "2026-09-05",
      requestedLabel: "5 September 2026",
      availableDates: ["2026-09-05"],
      referenceDate: SEP6,
    });
    expect(coverage.coverageStatus).toBe(COVERAGE_STATUS.COMPLETE);
  });

  test("latest available date is explicit", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-09-06",
      requestedEnd: "2026-09-06",
      requestedLabel: "the latest available sales date",
      availableDates: ["2026-09-05"],
      latestAvailableDate: "2026-09-05",
      referenceDate: SEP6,
    });
    expect(coverage.latestAvailableDate).toBe("2026-09-05");
  });

  test("MTD partial through latest available", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-09-01",
      requestedEnd: "2026-09-06",
      requestedLabel: "September 2026 (to date)",
      availableDates: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"],
      referenceDate: SEP6,
    });
    expect(coverage.coverageStatus).toBe(COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE);
    expect(spokenPeriodLabel(coverage)).toMatch(/1 Sep 2026–5 Sep 2026/);
  });

  test("last 7 days partial", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-08-31",
      requestedEnd: "2026-09-06",
      requestedLabel: "last 7 days",
      availableDates: ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"],
      referenceDate: SEP6,
    });
    expect(coverage.missingDates).toContain("2026-09-06");
    expect(coverage.coverageStatus).not.toBe(COVERAGE_STATUS.COMPLETE);
  });

  test("explicit incomplete range stays useful and disclosed", () => {
    const coverage = coverageFromCashUpAggregation(
      {
        dailyBreakdown: [
          { date: "2026-09-01", totalSales: 100 },
          { date: "2026-09-02", totalSales: 110 },
        ],
        salesCoverageEnd: "2026-09-02",
        requestedStartDate: "2026-09-01",
        requestedEndDate: "2026-09-05",
      },
      { startDate: "2026-09-01", endDate: "2026-09-05", label: "1–5 Sep 2026" },
      { referenceDate: SEP6 },
    );
    expect(coverage.coverageStatus).toBe(COVERAGE_STATUS.PARTIAL);
    expect(coverage.missingDates).toEqual(["2026-09-03", "2026-09-04", "2026-09-05"]);
  });

  test("complete historical August", () => {
    const dates = [];
    for (let d = 1; d <= 31; d += 1) dates.push(`2026-08-${String(d).padStart(2, "0")}`);
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-08-01",
      requestedEnd: "2026-08-31",
      requestedLabel: "August 2026",
      availableDates: dates,
      referenceDate: SEP6,
    });
    expect(coverage.coverageStatus).toBe(COVERAGE_STATUS.COMPLETE);
    expect(spokenPeriodLabel(coverage)).toBe("August 2026");
  });

  test("future date is no data", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-09-20",
      requestedEnd: "2026-09-20",
      requestedLabel: "20 September 2026",
      availableDates: [],
      referenceDate: SEP6,
    });
    expect(coverage.coverageStatus).toBe(COVERAGE_STATUS.NO_DATA);
  });

  test("missing exact date with latest disclosed", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-09-06",
      requestedEnd: "2026-09-06",
      requestedLabel: "6 September 2026",
      availableDates: [],
      latestAvailableDate: "2026-09-05",
      referenceDate: SEP6,
    });
    const text = applySpokenPeriodToAnswer("No cash-up report matched 6 September 2026.", coverage);
    expect(text).toMatch(/does not have sales data yet|available through 5 Sep/i);
  });

  test("sanitize strips ISO requested end when missingDayCount is present", () => {
    const text = sanitizeIncompletePeriodAnswer(
      "Sales for this week (2026-08-31 to 2026-09-06) are as follows: Net sales: 106224.30 SAR.",
      {
        keyMetrics: [
          { label: "day_count", value: 6 },
          { label: "expectedDayCount", value: 7 },
          { label: "missingDayCount", value: 1 },
        ],
      },
    );
    expect(text).toMatch(/through 5 Sep 2026/i);
    expect(text).not.toMatch(/2026-09-06/);
  });

  test("sanitize strips US month requested end when missingDayCount is present", () => {
    const text = sanitizeIncompletePeriodAnswer(
      "Sales for this week (August 31, 2026 - September 6, 2026) are as follows: Net sales: 106224.30 SAR.",
      {
        keyMetrics: [
          { label: "day_count", value: 6 },
          { label: "expectedDayCount", value: 7 },
          { label: "missingDayCount", value: 1 },
        ],
      },
    );
    expect(text).toMatch(/through 5 Sep 2026/i);
    expect(text).not.toMatch(/September 6, 2026/);
  });

  test("source delayed is not zero", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-09-01",
      requestedEnd: "2026-09-05",
      sourceFailed: true,
      referenceDate: SEP6,
    });
    expect(coverage.coverageStatus).toBe(COVERAGE_STATUS.SOURCE_DELAYED);
  });
});
