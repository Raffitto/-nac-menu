import {
  BRUNCH_SCHEDULE,
  DAYTIME_LUNCH_SCHEDULE,
  isBrunchDay,
} from "./brunchSchedule";

describe("brunchSchedule", () => {
  test("brunch is Friday and Saturday only", () => {
    expect(isBrunchDay(0)).toBe(false);
    expect(isBrunchDay(1)).toBe(false);
    expect(isBrunchDay(2)).toBe(false);
    expect(isBrunchDay(3)).toBe(false);
    expect(isBrunchDay(4)).toBe(false);
    expect(isBrunchDay(5)).toBe(true);
    expect(isBrunchDay(6)).toBe(true);
  });

  test("card schedule labels match Fri–Sat brunch and Sun–Thu daytime", () => {
    expect(BRUNCH_SCHEDULE.timeEn).toBe("Fri–Sat · 12–5 PM");
    expect(BRUNCH_SCHEDULE.timeAr).toBe("الجمعة–السبت · ١٢–٥ م");
    expect(DAYTIME_LUNCH_SCHEDULE.timeEn).toBe("Sun–Thu · 12–5 PM");
    expect(DAYTIME_LUNCH_SCHEDULE.timeAr).toBe("الأحد–الخميس · ١٢–٥ م");
  });
});
