import { shouldSkipAiNarration } from "./askNacNarrationSkip";
import { ASK_NAC_INTENTS } from "../intentRouter";

describe("shouldSkipAiNarration", () => {
  test("skips cash-up when executive brief and key metrics exist", () => {
    expect(shouldSkipAiNarration(
      ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
      { facts: [{ metricKey: "net_sales" }] },
      { periodType: "last_7_days" },
      {
        executiveBrief: { executiveSummary: "Net sales were 17,121 SAR." },
        keyMetrics: [{ label: "Net sales", value: "17,121 SAR" }],
        directAnswer: "Net sales were 17,121 SAR.",
      },
    )).toBe(true);
  });

  test("skips cash-up range aggregate path", () => {
    expect(shouldSkipAiNarration(
      ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
      { sources: [{ name: "get_vault_cash_up_range_aggregate" }] },
      { periodType: "last_7_days" },
      null,
    )).toBe(true);
  });

  test("skips document search when matches exist", () => {
    expect(shouldSkipAiNarration(
      ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH,
      { matches: [{ excerpt: "Weekly dashboard insight" }] },
      undefined,
      { directAnswer: "Found weekly dashboard patterns.", insights: ["Pattern A"] },
    )).toBe(true);
  });

  test("skips when conversation dataset is present", () => {
    expect(shouldSkipAiNarration(
      ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
      null,
      undefined,
      { conversationDataset: { dailyBreakdown: [{ date: "2026-06-22" }] } },
    )).toBe(true);
  });

  test("skips simple this-week sales regardless of intent", () => {
    expect(shouldSkipAiNarration(
      ASK_NAC_INTENTS.SALES_TOTAL,
      { aggregation: { dayCount: 6 } },
      { periodType: "this_week" },
      { directAnswer: "Khobar total sales for so far this period through 5 Sep 2026: 106,224.3 SAR." },
      "what are sales this week",
    )).toBe(true);
  });

  test("does not skip compare questions", () => {
    expect(shouldSkipAiNarration(
      ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
      {},
      { periodType: "this_week" },
      { directAnswer: "Sales were up." },
      "compare this week to last week",
    )).toBe(false);
  });

  test("does not skip unknown foodics intents", () => {
    expect(shouldSkipAiNarration(
      ASK_NAC_INTENTS.SALES_TOTAL,
      { total: 100 },
      undefined,
      { directAnswer: "Sales were 100 SAR." },
    )).toBe(false);
  });

  test("still skips knowledge health", () => {
    expect(shouldSkipAiNarration(
      ASK_NAC_INTENTS.VAULT_KNOWLEDGE_HEALTH,
      {},
      undefined,
      { directAnswer: "Health score 83/100." },
    )).toBe(true);
  });

  test("skips monthly logbook operational summary", () => {
    expect(shouldSkipAiNarration(
      ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW,
      { monthlyLogbookSummary: { directAnswer: "**Executive Summary**" }, structuredLogbookReview: true },
      { periodType: "month" },
      { directAnswer: "**Executive Summary**", isAiGenerated: false },
    )).toBe(true);
  });
});
