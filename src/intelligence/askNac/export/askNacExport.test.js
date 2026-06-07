import {
  buildAskNacExportPayload,
  resolveAnswerProvenance,
  hasExportableContent,
  hasTabularKeyMetrics,
  buildFilterContextSummary,
  PROVENANCE_IDS,
} from "./askNacExportPayload";
import { buildAskNacCsvContent } from "./askNacCsvExport";
import { ANSWER_TYPES } from "../askNacContract";

describe("askNac export", () => {
  const sampleResponse = {
    answerType: "metric",
    title: "Menu QR Scans · Today",
    directAnswer: "42 menu QR scans for Khobar (Today).",
    keyMetrics: [{ label: "Menu QR Scans", value: 42, source: "menu_events.funnel.qr_scans" }],
    insights: ["Month-to-date uses hybrid rollup + live Today merge."],
    recommendations: ["Verify branch filter."],
    sources: [{ name: "fetchAskNacMenuMetrics", detail: "hybrid" }],
    warnings: ["Month-to-date combines daily rollup with live Today (hybrid)."],
    missingData: [],
    confidence: "medium",
    isAiGenerated: false,
    periodLabel: "Today",
    branchLabel: "Khobar",
    diagnostics: {
      source: "hybrid",
      includesCurrentBusinessDay: true,
      partialLive: true,
      warnings: [],
    },
  };

  test("resolveAnswerProvenance marks partial hybrid deterministic", () => {
    const p = resolveAnswerProvenance(sampleResponse);
    expect(p.id).toBe(PROVENANCE_IDS.PARTIAL);
    expect(p.label).toMatch(/partial/i);
  });

  test("resolveAnswerProvenance marks missing-data reports", () => {
    const p = resolveAnswerProvenance({ answerType: ANSWER_TYPES.MISSING_DATA, directAnswer: "Not available" });
    expect(p.id).toBe(PROVENANCE_IDS.MISSING_DATA);
    expect(p.label).toMatch(/Data Requirement/i);
  });

  test("resolveAnswerProvenance marks AI-narrated answers", () => {
    const p = resolveAnswerProvenance({ ...sampleResponse, isAiGenerated: true, confidence: "high" });
    expect(p.id).toBe(PROVENANCE_IDS.AI_NARRATED);
  });

  test("buildAskNacExportPayload preserves warnings and sources", () => {
    const payload = buildAskNacExportPayload({
      question: "How many menu QR scans today?",
      response: sampleResponse,
      filters: { branch: "khobar", selectedRange: "today", timeRangeHours: 24 },
    });

    expect(payload.question).toContain("menu QR");
    expect(payload.warnings).toHaveLength(1);
    expect(payload.sources[0].name).toBe("fetchAskNacMenuMetrics");
    expect(payload.keyMetrics[0].value).toBe(42);
    expect(payload.meta.provenance.id).toBe(PROVENANCE_IDS.PARTIAL);
    expect(payload.context.filterSummary).toMatch(/Khobar/);
    expect(payload.diagnostics.source).toBe("hybrid");
    expect(payload.dataCompleteness.length).toBeGreaterThan(0);
  });

  test("hasExportableContent allows missing-data answers", () => {
    expect(
      hasExportableContent({
        answerType: ANSWER_TYPES.MISSING_DATA,
        directAnswer: "Guest count schema not enabled.",
        missingData: [{ label: "Average spend per guest" }],
      }),
    ).toBe(true);
  });

  test("buildAskNacCsvContent includes metrics and context", () => {
    const payload = buildAskNacExportPayload({
      question: "Menu sessions?",
      response: sampleResponse,
      filters: { branch: "khobar", selectedRange: "today" },
    });
    expect(hasTabularKeyMetrics(payload)).toBe(true);
    const csv = buildAskNacCsvContent(payload);
    expect(csv).toMatch(/Menu QR Scans/);
    expect(csv).toMatch(/42/);
    expect(csv).toMatch(/Khobar/);
  });

  test("buildFilterContextSummary includes branch and range", () => {
    const summary = buildFilterContextSummary({
      branch: "riyadh",
      selectedRange: "month",
      language: "all",
    });
    expect(summary).toMatch(/Riyadh/);
    expect(summary).toMatch(/Month-to-date/);
  });
});
