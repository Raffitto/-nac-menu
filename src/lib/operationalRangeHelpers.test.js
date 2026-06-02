import {
  sevenDayWindowFullyInsideCalendarMonth,
  operationalRangeContextNote,
  monthSevenDayIntegrityWarning,
  sessionQualityCaption,
  rememberSevenDayMenuQr,
  readCachedSevenDayMenuQr,
} from "./operationalRangeHelpers";

describe("operationalRangeHelpers", () => {
  test("early in month, 7D window is not fully inside calendar month", () => {
    const june2 = new Date("2026-06-02T12:00:00+03:00");
    expect(sevenDayWindowFullyInsideCalendarMonth(june2)).toBe(false);
    expect(operationalRangeContextNote("month", june2)).toContain("Month-to-date");
  });

  test("late in month, 7D window can sit fully inside month-to-date", () => {
    const june12 = new Date("2026-06-12T12:00:00+03:00");
    expect(sevenDayWindowFullyInsideCalendarMonth(june12)).toBe(true);
    expect(operationalRangeContextNote("month", june12)).toBeNull();
  });

  test("month integrity warning when MTD QR trails cached 7D inside same month", () => {
    const june12 = new Date("2026-06-12T12:00:00+03:00");
    const msg = monthSevenDayIntegrityWarning({
      selectedRange: "month",
      monthQr: 100,
      sevenDayQr: 150,
      referenceDate: june12,
    });
    expect(msg).toMatch(/lower than 7D/i);
  });

  test("session quality caption labels live sample on rollup ranges", () => {
    const text = sessionQualityCaption({
      isPartial: true,
      classifiedCount: 13,
      totalSessions: 327,
      selectedRange: "month",
      fromLivePatch: true,
    });
    expect(text).toMatch(/recent classified session/i);
    expect(text).toMatch(/not the full selected range/i);
  });

  test("session quality caption for today stays period-scoped when not live patch", () => {
    const text = sessionQualityCaption({
      isPartial: true,
      classifiedCount: 13,
      totalSessions: 13,
      selectedRange: "today",
      fromLivePatch: false,
    });
    expect(text).toMatch(/13 classified session/i);
    expect(text).not.toMatch(/recent/i);
  });

  test("seven day menu QR cache round-trip", () => {
    rememberSevenDayMenuQr(1741);
    expect(readCachedSevenDayMenuQr()).toBe(1741);
  });
});
