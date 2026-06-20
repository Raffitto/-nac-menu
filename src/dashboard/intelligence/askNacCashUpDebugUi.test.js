/** @jest-environment jsdom */

import { shouldShowCashUpDebugPanel } from "./askNacCashUpDebugUi";

describe("shouldShowCashUpDebugPanel", () => {
  const original = process.env.REACT_APP_ASK_NAC_CASHUP_DEBUG;

  afterEach(() => {
    if (original === undefined) delete process.env.REACT_APP_ASK_NAC_CASHUP_DEBUG;
    else process.env.REACT_APP_ASK_NAC_CASHUP_DEBUG = original;
  });

  test("is hidden by default", () => {
    delete process.env.REACT_APP_ASK_NAC_CASHUP_DEBUG;
    expect(shouldShowCashUpDebugPanel()).toBe(false);
  });

  test("is visible only when developer flag is true", () => {
    process.env.REACT_APP_ASK_NAC_CASHUP_DEBUG = "true";
    expect(shouldShowCashUpDebugPanel()).toBe(true);
  });
});
