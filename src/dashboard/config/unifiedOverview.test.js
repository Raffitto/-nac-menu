import { isUnifiedOverviewEnabled } from "./unifiedOverview";

describe("isUnifiedOverviewEnabled", () => {
  const original = process.env.REACT_APP_UNIFIED_OVERVIEW;

  afterEach(() => {
    if (original === undefined) delete process.env.REACT_APP_UNIFIED_OVERVIEW;
    else process.env.REACT_APP_UNIFIED_OVERVIEW = original;
  });

  test("enabled when env is 1", () => {
    process.env.REACT_APP_UNIFIED_OVERVIEW = "1";
    expect(isUnifiedOverviewEnabled()).toBe(true);
  });

  test("disabled otherwise", () => {
    delete process.env.REACT_APP_UNIFIED_OVERVIEW;
    expect(isUnifiedOverviewEnabled()).toBe(false);
  });
});
