import {
  parseVaultComparePeriodsFromQuestion,
  parseVaultPeriodFromQuestion,
} from "./vaultPeriodParser";

const SEP6 = new Date("2026-09-06T12:00:00+03:00");

describe("Ask NAC comparison period resolution", () => {
  test("compare this week to last week on Sunday has no completed current-week days", () => {
    const compare = parseVaultComparePeriodsFromQuestion("compare this week to last week", SEP6);
    expect(compare?.current?.startDate).toBe("2026-09-06");
    expect(compare?.current?.requestedEndDate).toBe("2026-09-12");
    expect(compare?.current?.noCompletedDays).toBe(true);
    expect(compare?.previous?.startDate).toBe("2026-08-30");
    expect(compare?.previous?.endDate).toBe("2026-09-05");
    expect(compare?.likeForLike).toBe(false);
  });

  test("compare this week to last week before 08:00 Monday does not treat Sunday as complete", () => {
    const mondayEarly = new Date("2026-09-07T00:36:00+03:00");
    const compare = parseVaultComparePeriodsFromQuestion("compare this week to last week", mondayEarly);
    expect(compare?.current?.requestedStartDate).toBe("2026-09-06");
    expect(compare?.current?.requestedEndDate).toBe("2026-09-12");
    expect(compare?.current?.noCompletedDays).toBe(true);
    expect(compare?.current?.endDate).not.toBe("2026-09-06");
    expect(compare?.previous?.startDate).toBe("2026-08-30");
    expect(compare?.previous?.endDate).toBe("2026-09-05");
    expect(compare?.likeForLike).toBe(false);
  });

  test("week over week on Wednesday is like-for-like weekday positions", () => {
    const wed = new Date("2026-09-09T12:00:00+03:00");
    const compare = parseVaultComparePeriodsFromQuestion("week over week", wed);
    expect(compare?.current?.startDate).toBe("2026-09-06");
    expect(compare?.current?.endDate).toBe("2026-09-08");
    expect(compare?.previous?.startDate).toBe("2026-08-30");
    expect(compare?.previous?.endDate).toBe("2026-09-01");
    expect(compare?.likeForLike).toBe(true);
  });

  test("MTD compare after Riyadh midnight still uses 1–5 Sep vs 1–5 Aug", () => {
    const mondayEarly = new Date("2026-09-07T00:36:00+03:00");
    const compare = parseVaultComparePeriodsFromQuestion("compare MTD to last month", mondayEarly);
    expect(compare?.current?.startDate).toBe("2026-09-01");
    expect(compare?.current?.endDate).toBe("2026-09-05");
    expect(compare?.previous?.startDate).toBe("2026-08-01");
    expect(compare?.previous?.endDate).toBe("2026-08-05");
    expect(compare?.likeForLike).toBe(true);
  });

  test("compare MTD to last month mirrors completed September days onto August", () => {
    const compare = parseVaultComparePeriodsFromQuestion("compare MTD to last month", SEP6);
    expect(compare?.current?.startDate).toBe("2026-09-01");
    expect(compare?.current?.endDate).toBe("2026-09-05");
    expect(compare?.previous?.startDate).toBe("2026-08-01");
    expect(compare?.previous?.endDate).toBe("2026-08-05");
    expect(compare?.likeForLike).toBe(true);
  });

  test("compare yesterday to previous day", () => {
    const compare = parseVaultComparePeriodsFromQuestion("compare yesterday to the previous day", SEP6);
    expect(compare?.current?.startDate).toBe("2026-09-05");
    expect(compare?.previous?.startDate).toBe("2026-09-04");
    expect(compare?.current?.endDate).toBe(compare?.current?.startDate);
    expect(compare?.previous?.endDate).toBe(compare?.previous?.startDate);
  });

  test("Unicode dashes parse the same as ASCII day ranges", () => {
    const hyphen = parseVaultComparePeriodsFromQuestion("compare Sep 1-5 to Aug 1-5", SEP6);
    const en = parseVaultComparePeriodsFromQuestion("compare Sep 1–5 to Aug 1–5", SEP6);
    const em = parseVaultComparePeriodsFromQuestion("compare Sep 1 — 5 to Aug 1 — 5", SEP6);
    const dmy = parseVaultComparePeriodsFromQuestion("compare 1–5 Sep to 1–5 Aug", SEP6);
    expect(en?.current?.startDate).toBe("2026-09-01");
    expect(en?.current?.endDate).toBe("2026-09-05");
    expect(en?.previous?.startDate).toBe("2026-08-01");
    expect(en?.previous?.endDate).toBe("2026-08-05");
    expect(em?.current?.endDate).toBe(hyphen?.current?.endDate);
    expect(dmy?.current?.endDate).toBe("2026-09-05");
  });

  test("compare Sep 1-5 to Aug 1-5", () => {
    const compare = parseVaultComparePeriodsFromQuestion("compare Sep 1-5 to Aug 1-5", SEP6);
    expect(compare?.current?.startDate).toBe("2026-09-01");
    expect(compare?.current?.endDate).toBe("2026-09-05");
    expect(compare?.previous?.startDate).toBe("2026-08-01");
    expect(compare?.previous?.endDate).toBe("2026-08-05");
  });

  test("range typography variants resolve the same day span", () => {
    const cases = [
      "Sep 1-5",
      "Sep 1–5",
      "Sep 1 — 5",
      "September 1–5",
      "Sep 1 – Sep 5",
      "1–5 Sep",
      "1 — 5 September",
      "Sep 1–5 2026",
    ];
    for (const phrase of cases) {
      const period = parseVaultPeriodFromQuestion(`sales ${phrase}`, SEP6);
      expect(period?.startDate).toBe("2026-09-01");
      expect(period?.endDate).toBe("2026-09-05");
    }
  });

  test("cross-month Unicode range stays intact", () => {
    const period = parseVaultPeriodFromQuestion("sales Aug 30–Sep 5", SEP6);
    expect(period?.startDate).toBe("2026-08-30");
    expect(period?.endDate).toBe("2026-09-05");
  });
});
