import { fromFailedSource, fromSuccessfulNumber, isVerifiedZero, formatMetricDisplay } from "../lib/dataTruth";
import { buildTemporalCoverage, applySpokenPeriodToAnswer, COVERAGE_STATUS } from "../intelligence/askNac/coverage/temporalCoverage";
import { parseVaultPeriodFromQuestion } from "../intelligence/askNac/vault/vaultPeriodParser";
import { coveringBatchIds } from "../lib/foodicsApi";

describe("production reliability contracts", () => {
  test("AUTH/data truth: failed source cannot become zero", () => {
    const failed = fromFailedSource("timeout");
    expect(isVerifiedZero(failed)).toBe(false);
    expect(formatMetricDisplay(failed)).toBe("Unavailable");
    expect(fromSuccessfulNumber(0).value).toBe(0);
  });

  test("REVIEWS: missing Google metrics stay unavailable", () => {
    const competitor = fromFailedSource("missing_place_id", { source: "google_places" });
    expect(formatMetricDisplay(competitor)).toBe("Unavailable");
    expect(competitor.value).toBeNull();
  });

  test("REPORTS: no covering Foodics batch is empty, not a hang", () => {
    const ids = coveringBatchIds(
      [{ id: "aug", period_start: "2026-08-01", period_end: "2026-08-31" }],
      "2026-09-01",
      "2026-09-05",
    );
    expect(ids).toEqual([]);
  });

  test("ASK NAC: Sep 6 week is spoken as through 5 Sep", () => {
    const coverage = buildTemporalCoverage({
      requestedStart: "2026-08-31",
      requestedEnd: "2026-09-06",
      requestedLabel: "Monday, 31 August – Sunday, 6 September",
      availableDates: ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"],
      referenceDate: new Date("2026-09-06T19:00:00+03:00"),
    });
    expect(coverage.coverageStatus).toBe(COVERAGE_STATUS.CURRENT_DAY_NOT_COMPLETE);
    const answer = applySpokenPeriodToAnswer(
      "For Khobar in Monday, 31 August – Sunday, 6 September, net sales were SAR 106224.3.",
      coverage,
      { weekish: true },
    );
    expect(answer).not.toMatch(/For Khobar in Monday, 31 August – Sunday, 6 September/);
    expect(answer).toMatch(/through 5 Sep 2026/i);
  });

  test("ASK NAC: latest sales is not calendar today", () => {
    const period = parseVaultPeriodFromQuestion(
      "what are the latest sales",
      new Date("2026-09-06T19:00:00+03:00"),
    );
    expect(period.periodType).toBe("latest_available_sale");
    expect(period.startDate).toBe("2026-09-05");
    expect(period.endDate).toBe("2026-09-05");
    expect(period.startDate).not.toBe("2026-09-06");
  });
});
