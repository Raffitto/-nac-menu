import { monthBoundsFromToken, parseHalfMonthPhrase } from "./vaultPeriodParser";

const juneMidnightUtc = new Date("2026-05-31T21:30:00Z");
const juneJustAfterMidnight = new Date("2026-06-01T00:05:00+03:00");
const januaryMidnight = new Date("2025-12-31T21:30:00Z");
const juneTenthNoon = new Date("2026-06-10T12:00:00+03:00");
const juneTwentyOneNoon = new Date("2026-06-21T12:00:00+03:00");
const juneTwentyOneBeforeEight = new Date("2026-06-21T07:00:00+03:00");

test("June just after Riyadh midnight stays 2026 on a UTC clock", () => {
  const period = monthBoundsFromToken("june", null, juneMidnightUtc);
  expect(period.startDate).toBe("2026-06-01");
  expect(period.endDate).toBe("2026-06-30");
});

test("June 1 just after midnight has no completed first-half day yet", () => {
  const period = parseHalfMonthPhrase("first half of June", juneJustAfterMidnight);
  expect(period.startDate).toBe("2026-06-01");
  expect(period.noCompletedDays).toBe(true);
});

test("December asked on 1 January Riyadh resolves to the previous year", () => {
  const period = monthBoundsFromToken("december", null, januaryMidnight);
  expect(period.startDate).toBe("2025-12-01");
  expect(period.endDate).toBe("2025-12-31");
});

test("first half before the 15th stops on the completed business day", () => {
  const period = parseHalfMonthPhrase("first half of June", juneTenthNoon);
  expect(period.startDate).toBe("2026-06-01");
  expect(period.endDate).toBe("2026-06-09");
  expect(period.noCompletedDays).toBe(false);
});

test("a completed afternoon includes yesterday and an early morning does not", () => {
  const afternoon = parseHalfMonthPhrase("second half of June", juneTwentyOneNoon);
  const morning = parseHalfMonthPhrase("second half of June", juneTwentyOneBeforeEight);
  expect(afternoon.endDate).toBe("2026-06-20");
  expect(morning.endDate).toBe("2026-06-19");
});
