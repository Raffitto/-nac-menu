import {
  parseVaultComparePeriodsFromQuestion,
} from "./vaultPeriodParser";

const SEP6 = new Date("2026-09-06T12:00:00+03:00");

describe("Ask NAC comparison period resolution", () => {
  test("compare this week to last week is like-for-like completed days", () => {
    const compare = parseVaultComparePeriodsFromQuestion("compare this week to last week", SEP6);
    expect(compare?.current?.startDate).toBe("2026-08-31");
    expect(compare?.current?.endDate).toBe("2026-09-05");
    expect(compare?.previous?.startDate).toBe("2026-08-25");
    expect(compare?.previous?.endDate).toBe("2026-08-30");
    expect(compare?.likeForLike).toBe(true);
    expect(compare?.current?.noCompletedDays).toBeFalsy();
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

  test("compare Sep 1-5 to Aug 1-5", () => {
    const compare = parseVaultComparePeriodsFromQuestion("compare Sep 1-5 to Aug 1-5", SEP6);
    expect(compare?.current?.startDate).toBe("2026-09-01");
    expect(compare?.current?.endDate).toBe("2026-09-05");
    expect(compare?.previous?.startDate).toBe("2026-08-01");
    expect(compare?.previous?.endDate).toBe("2026-08-05");
  });
});
