import {
  buildNarrationPayload,
  mergeNarratedResponse,
  validateMetricPreservation,
  extractMetricNumericSignature,
  MAX_FACT_ROWS,
} from "./openAiNarrator";
import { resolveFoodicsPeriodWithFallback, monthBounds } from "./periodFallback";
import { MONTH_HOURS } from "../../../dashboard/utils/rangeState";

describe("openAiNarrator", () => {
  const baseAnswer = {
    answerType: "metric",
    title: "Foodics sales · May 2026",
    directAnswer: "SAR 12,000.00 net sales for Khobar (May 2026).",
    keyMetrics: [
      { label: "Net sales", value: 12000, unit: "SAR" },
      { label: "Gross sales", value: 13000, unit: "SAR" },
    ],
    insights: ["Upload batch: may.xlsx"],
    recommendations: [],
    sources: [{ name: "foodics_sales_items", detail: "batch" }],
    warnings: [],
    missingData: [],
    vaultSources: [],
    confidence: "high",
    isAiGenerated: false,
  };

  test("buildNarrationPayload caps fact rows", () => {
    const payload = buildNarrationPayload(baseAnswer, {
      question: "What were sales in May?",
      intent: "sales_total",
      tool: { topItems: Array.from({ length: 40 }, (_, i) => ({ rank: i + 1 })) },
    });
    expect(payload.deterministicAnswer.keyMetrics.length).toBeLessThanOrEqual(MAX_FACT_ROWS);
    expect(payload.toolFacts.topItems.length).toBeLessThanOrEqual(MAX_FACT_ROWS);
  });

  test("mergeNarratedResponse preserves numeric metrics", () => {
    const merged = mergeNarratedResponse(baseAnswer, {
      directAnswer: "Net sales reached SAR 12,000 in May for Khobar — from uploaded Foodics batch.",
      insights: ["May batch covers full calendar month."],
      keyMetrics: [
        { label: "Net sales", value: 12000, unit: "SAR" },
        { label: "Gross sales", value: 13000, unit: "SAR" },
      ],
    });
    expect(merged.isAiGenerated).toBe(true);
    expect(merged.keyMetrics[0].value).toBe(12000);
    expect(merged.sources).toEqual(baseAnswer.sources);
  });

  test("rejects AI output that changes numbers", () => {
    const merged = mergeNarratedResponse(baseAnswer, {
      directAnswer: "Sales were higher than expected.",
      keyMetrics: [
        { label: "Net sales", value: 99999, unit: "SAR" },
        { label: "Gross sales", value: 13000, unit: "SAR" },
      ],
    });
    expect(merged.isAiGenerated).toBe(false);
    expect(merged.warnings.some((w) => /changed verified numbers/i.test(w))).toBe(true);
    expect(merged.keyMetrics[0].value).toBe(12000);
  });

  test("validateMetricPreservation detects label/value drift", () => {
    const sig = extractMetricNumericSignature(baseAnswer.keyMetrics);
    expect(sig).toHaveLength(2);
    expect(
      validateMetricPreservation(baseAnswer.keyMetrics, [
        { label: "Net sales", value: 12000, unit: "SAR" },
        { label: "Gross sales", value: 13000, unit: "SAR" },
      ]),
    ).toBe(true);
    expect(
      validateMetricPreservation(baseAnswer.keyMetrics, [
        { label: "Net sales", value: 12001, unit: "SAR" },
        { label: "Gross sales", value: 13000, unit: "SAR" },
      ]),
    ).toBe(false);
  });
});

describe("periodFallback", () => {
  test("uses MTD when filter is month-to-date", async () => {
    const result = await resolveFoodicsPeriodWithFallback(null, {
      question: "Which category generated the most revenue?",
      filters: { timeRangeHours: MONTH_HOURS, selectedRange: "month" },
    });
    expect(result.period?.startDate).toMatch(/^\d{4}-\d{2}-01$/);
    expect(result.source).toBe("filter_mtd");
    expect(result.warnings[0]).toMatch(/Month-to-date/i);
  });

  test("prefers explicit question period over filter", async () => {
    const result = await resolveFoodicsPeriodWithFallback(null, {
      question: "Which category generated the most revenue in May?",
      filters: { timeRangeHours: MONTH_HOURS },
    });
    expect(result.period?.startDate).toBe("2026-05-01");
    expect(result.source).toBe("question");
    expect(result.warnings).toHaveLength(0);
  });

  test("monthBounds returns calendar month edges", () => {
    const may = monthBounds(2026, 4);
    expect(may.startDate).toBe("2026-05-01");
    expect(may.endDate).toBe("2026-05-31");
    expect(may.label).toMatch(/May/i);
  });
});

describe("askNac client status fields", () => {
  test("server response shape includes aiConnected and localFallback flags", () => {
    const serverPayload = {
      directAnswer: "42 menu QR scans",
      isAiGenerated: true,
      serverConnected: true,
      aiConnected: true,
      localFallback: false,
    };
    expect(serverPayload.isAiGenerated).toBe(true);
    expect(serverPayload.aiConnected).toBe(true);
    expect(serverPayload.localFallback).toBe(false);
  });

  test("local fallback marks flags correctly", () => {
    const localPayload = {
      directAnswer: "42 menu QR scans",
      isAiGenerated: false,
      serverConnected: false,
      localFallback: true,
      aiConnected: false,
    };
    expect(localPayload.localFallback).toBe(true);
    expect(localPayload.aiConnected).toBe(false);
  });
});
