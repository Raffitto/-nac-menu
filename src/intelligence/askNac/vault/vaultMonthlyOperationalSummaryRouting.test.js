import { isVaultMonthlyOperationalSummaryQuery, extractOperationalMonthPeriod } from "./vaultMonthlyOperationalSummaryRouting";

describe("monthly operational logbook routing", () => {
  test.each([
    "October operations",
    "operations in October 2026",
    "operationally during October 2026",
    "Summarize operational problems at NAC Khobar during October 2026",
    "What were the most important operational problems at NAC Khobar during October 2026?",
  ])("recognizes operational month request: %s", (question) => {
    expect(isVaultMonthlyOperationalSummaryQuery(question)).toBe(true);
    expect(extractOperationalMonthPeriod(question, new Date("2026-10-22T12:00:00Z"))).not.toBeNull();
  });

  test.each([
    "Compare sales in October vs September",
    "What were net sales in October?",
    "What happened on 12 October 2026?",
  ])("does not hijack unrelated or single-day questions: %s", (question) => {
    expect(isVaultMonthlyOperationalSummaryQuery(question)).toBe(false);
  });
});
