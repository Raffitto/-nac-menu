import { isUnifiedOverviewEnabled } from "./unifiedOverview";

describe("isUnifiedOverviewEnabled", () => {
  const originalOverview = process.env.REACT_APP_UNIFIED_OVERVIEW;
  const originalPlatform = process.env.REACT_APP_PLATFORM_MODE;

  afterEach(() => {
    if (originalOverview === undefined) delete process.env.REACT_APP_UNIFIED_OVERVIEW;
    else process.env.REACT_APP_UNIFIED_OVERVIEW = originalOverview;
    if (originalPlatform === undefined) delete process.env.REACT_APP_PLATFORM_MODE;
    else process.env.REACT_APP_PLATFORM_MODE = originalPlatform;
  });

  test("enabled when env is 1", () => {
    process.env.REACT_APP_UNIFIED_OVERVIEW = "1";
    delete process.env.REACT_APP_PLATFORM_MODE;
    expect(isUnifiedOverviewEnabled()).toBe(true);
  });

  test("disabled when env is 0", () => {
    process.env.REACT_APP_UNIFIED_OVERVIEW = "0";
    process.env.REACT_APP_PLATFORM_MODE = "admin";
    expect(isUnifiedOverviewEnabled()).toBe(false);
  });

  test("enabled by default on admin platform builds", () => {
    delete process.env.REACT_APP_UNIFIED_OVERVIEW;
    process.env.REACT_APP_PLATFORM_MODE = "admin";
    expect(isUnifiedOverviewEnabled()).toBe(true);
  });

  test("disabled by default on public platform builds", () => {
    delete process.env.REACT_APP_UNIFIED_OVERVIEW;
    process.env.REACT_APP_PLATFORM_MODE = "public";
    expect(isUnifiedOverviewEnabled()).toBe(false);
  });
});
