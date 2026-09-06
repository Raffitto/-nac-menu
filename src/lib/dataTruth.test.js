import {
  METRIC_STATUS,
  fromSuccessfulNumber,
  fromFailedSource,
  isVerifiedZero,
  canDisplayNumeric,
  formatMetricDisplay,
  numericOrNull,
} from "./dataTruth";

describe("dataTruth contract", () => {
  test("verified zero is allowed to display 0", () => {
    const m = fromSuccessfulNumber(0, { source: "review_events" });
    expect(m.status).toBe(METRIC_STATUS.VERIFIED);
    expect(isVerifiedZero(m)).toBe(true);
    expect(formatMetricDisplay(m)).toBe(0);
    expect(numericOrNull(m)).toBe(0);
  });

  test("null from a failed source is not zero", () => {
    const m = fromFailedSource("fetch_failed", { source: "google_places" });
    expect(isVerifiedZero(m)).toBe(false);
    expect(canDisplayNumeric(m)).toBe(false);
    expect(formatMetricDisplay(m)).toBe("Unavailable");
    expect(numericOrNull(m)).toBeNull();
  });

  test("empty successful payload is unavailable, not zero", () => {
    const m = fromSuccessfulNumber(null, { source: "google_places" });
    expect(m.status).toBe(METRIC_STATUS.UNAVAILABLE);
    expect(formatMetricDisplay(m)).toBe("Unavailable");
    expect(numericOrNull(m)).toBeNull();
  });

  test("NaN does not become zero", () => {
    const m = fromSuccessfulNumber("n/a");
    expect(canDisplayNumeric(m)).toBe(false);
    expect(formatMetricDisplay(m)).not.toBe(0);
  });
});
