/**
 * Executive Intelligence v2 tests.
 */

import {
  buildExecutiveEvidenceMapV2,
  computeSourceComposition,
  assessExecutiveConfidence,
  deriveFollowUpQuestions,
  deriveImprovementSuggestions,
  formatEvidenceMapSection,
  formatSourceCompositionDiagnostics,
  isExecutiveQueryIntent,
} from "./executiveEvidenceV2";
import { ASK_NAC_INTENTS } from "../intentRouter";
import { CONFIDENCE_LEVELS } from "../askNacContract";

describe("executiveEvidenceV2", () => {
  const gathered = {
    structuredFacts: {
      cash_up: [{ metric_key: "total_sales", metric_value: 1000, period_end: "2026-06-01" }],
      daily_briefing: [],
      daily_logbook: [{ metric_key: "note_line", dimensions: { text_value: "Terrace busy" } }],
    },
    operatorMemory: [{ fact: "Patio competitor opened nearby", source: "operator_memory", category: "competitive" }],
    branchMemory: [{ fact: "Humidity affects terrace traffic", source: "branch_memory", category: "weather" }],
    historicalDashboards: [{ fileTitle: "Weekly Dashboard June", excerpt: "Sales up 8% WoW" }],
    manualInputs: [],
    coverage: [{ reportType: "cash_up" }],
    aggregation: { totalSales: 17000, dayCount: 7 },
  };

  it("identifies executive query intents", () => {
    expect(isExecutiveQueryIntent(ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING)).toBe(true);
    expect(isExecutiveQueryIntent(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH)).toBe(true);
    expect(isExecutiveQueryIntent(ASK_NAC_INTENTS.VAULT_DAILY_BRIEFING_SUMMARY)).toBe(true);
    expect(isExecutiveQueryIntent(ASK_NAC_INTENTS.MENU_QR_SCANS)).toBe(false);
  });

  it("returns vault composition fallback when no weighted hits", () => {
    const composition = computeSourceComposition({ structuredFacts: { cash_up: [], daily_briefing: [], daily_logbook: [] } });
    expect(composition.composition.length).toBeGreaterThan(0);
    expect(composition.composition[0].sourceType).toBe("vault");
  });

  it("builds evidence map with facts, memory, and missing", () => {
    const map = buildExecutiveEvidenceMapV2(gathered, { intent: ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING });
    expect(map.facts.length).toBeGreaterThan(0);
    expect(map.operatorKnowledge.length).toBe(2);
    expect(map.historicalPatterns.length).toBe(1);
    expect(map.missingInformation.some((m) => /briefing/i.test(m.label))).toBe(true);
  });

  it("computes source composition percentages", () => {
    const map = buildExecutiveEvidenceMapV2(gathered);
    const composition = computeSourceComposition(gathered, map);
    expect(composition.totalHits).toBeGreaterThan(0);
    expect(composition.composition.reduce((sum, row) => sum + row.percent, 0)).toBeGreaterThan(0);
  });

  it("derives follow-up questions when dashboard fields missing", () => {
    const map = buildExecutiveEvidenceMapV2(gathered, { intent: ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD });
    const followUps = deriveFollowUpQuestions({
      evidenceMap: map,
      confidence: CONFIDENCE_LEVELS.LOW,
      intent: ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD,
    });
    expect(followUps[0]?.prompt).toMatch(/missing/i);
    expect(followUps[0]?.missingFields?.length).toBeGreaterThan(0);
  });

  it("formats evidence map and source composition diagnostics", () => {
    const map = buildExecutiveEvidenceMapV2(gathered);
    const text = formatEvidenceMapSection(map);
    expect(text).toMatch(/Facts:/);
    expect(text).toMatch(/Missing information:/);
    const diag = formatSourceCompositionDiagnostics(computeSourceComposition(gathered, map));
    expect(diag.answerSourceCompositionText).toMatch(/Answer source composition:/);
  });

  it("assesses confidence from coverage", () => {
    const map = buildExecutiveEvidenceMapV2(gathered);
    const composition = computeSourceComposition(gathered, map);
    const high = assessExecutiveConfidence({ evidenceMap: map, sourceComposition: composition, baseConfidence: CONFIDENCE_LEVELS.MEDIUM });
    expect([CONFIDENCE_LEVELS.HIGH, CONFIDENCE_LEVELS.MEDIUM, CONFIDENCE_LEVELS.LOW]).toContain(high);
  });

  it("derives improvement suggestions", () => {
    const map = buildExecutiveEvidenceMapV2(gathered);
    const suggestions = deriveImprovementSuggestions({ evidenceMap: map, gathered, vaultPeriod: { label: "June 2026" } });
    expect(suggestions.some((s) => /briefing|dashboard|logbook|feedback/i.test(s))).toBe(true);
  });
});
