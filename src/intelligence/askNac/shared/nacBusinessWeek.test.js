import {
  latestCompletedBusinessDate,
  nacBusinessWeekRange,
  nacLastWeekPeriod,
  nacLikeForLikePriorWeek,
  nacPreviousBusinessWeekRange,
  nacThisWeekPeriod,
} from "./nacBusinessWeek";

const SUN6 = new Date("2026-09-06T12:00:00+03:00");
const WED9 = new Date("2026-09-09T12:00:00+03:00");

describe("NAC Sunday-start business week", () => {
  test("Sunday 6 Sep belongs to 6–12 Sep", () => {
    expect(nacBusinessWeekRange("2026-09-06")).toEqual({
      startDate: "2026-09-06",
      endDate: "2026-09-12",
    });
    expect(nacThisWeekPeriod(SUN6).startDate).toBe("2026-09-06");
    expect(nacThisWeekPeriod(SUN6).endDate).toBe("2026-09-12");
  });

  test("previous full business week is 30 Aug–5 Sep", () => {
    expect(nacPreviousBusinessWeekRange("2026-09-06")).toEqual({
      startDate: "2026-08-30",
      endDate: "2026-09-05",
    });
    expect(nacLastWeekPeriod(SUN6).startDate).toBe("2026-08-30");
    expect(nacLastWeekPeriod(SUN6).endDate).toBe("2026-09-05");
  });

  test("partial week like-for-like uses same weekday positions", () => {
    expect(nacThisWeekPeriod(WED9)).toMatchObject({
      startDate: "2026-09-06",
      endDate: "2026-09-12",
    });
    expect(nacLikeForLikePriorWeek("2026-09-06", "2026-09-08")).toEqual({
      startDate: "2026-08-30",
      endDate: "2026-09-01",
    });
  });

  test("Cash Up completed-day lag does not flip at midnight", () => {
    expect(latestCompletedBusinessDate(new Date("2026-09-06T12:00:00+03:00"))).toBe("2026-09-05");
    expect(latestCompletedBusinessDate(new Date("2026-09-07T00:36:00+03:00"))).toBe("2026-09-05");
    expect(latestCompletedBusinessDate(new Date("2026-09-07T08:00:00+03:00"))).toBe("2026-09-06");
  });
});
