/**
 * Knowledge Health Engine tests — calibrated scoring.
 */

import {
  computeKnowledgeHealth,
  detectKnowledgeHealthFocus,
  scoreCoverageCompleteness,
  assessDashboardReadiness,
  assessExecutiveIntelligenceReadiness,
  buildMissingInformationRegistry,
} from "./knowledgeHealthEngine";

/** Khobar June 2026-like snapshot from production registry (pre-calibration baseline inputs). */
const khobarJuneSnapshot = {
  branch: "khobar",
  branchLabel: "Khobar",
  periodLabel: "June 2026",
  coverage: [
    { reportType: "cash_up", readinessStatus: "ready", factCount: 4095 },
    { reportType: "daily_logbook", readinessStatus: "partial", factCount: 5 },
    { reportType: "daily_logbook", readinessStatus: "partial", factCount: 4 },
    { reportType: "daily_logbook", readinessStatus: "registered", factCount: 0 },
  ],
  fileInventory: {
    reception_daily_report: 11,
    daily_briefing: 14,
    weekly_dashboard: 2,
  },
  guestFeedbackCoverage: [],
  weekAggregation: { dayCount: 22, totalSales: 17000 },
  logbookFacts: [{ dimensions: { text_value: "Terrace busy at lunch" } }],
  googleReviewFacts: [{ metric_key: "google_review_5", metric_value: 41 }],
  manualInputs: [],
  historicalDashboardCoverage: [
    { reportType: "weekly_dashboard", readinessStatus: "registered", factCount: 0 },
    { reportType: "weekly_dashboard", readinessStatus: "registered", factCount: 0 },
  ],
  ingestionJobs: Array.from({ length: 100 }, (_, i) => ({
    status: i < 44 ? "completed" : "failed",
    error: i >= 44 ? "parse error" : null,
    fileTitle: `job-${i}`,
  })),
  pendingSessions: [],
  discoveryCandidates: [],
};

function legacyCoverageScore(coverage, fileInventory) {
  const types = ["cash_up", "daily_briefing", "daily_logbook", "reception_daily_report"];
  const byType = new Map();
  for (const row of coverage) {
    const type = row.reportType;
    const credit = row.readinessStatus === "ready" ? 1 : row.readinessStatus === "partial" ? 0.5 : 0;
    byType.set(type, Math.max(byType.get(type) || 0, credit));
  }
  let sum = 0;
  for (const t of types) sum += byType.get(t) || 0;
  return Math.round((sum / types.length) * 100);
}

function legacyExecutiveScore(coverage) {
  const weights = { cash_up: 0.25, daily_briefing: 0.25, daily_logbook: 0.2, guest_feedback: 0.15, weekly_dashboard: 0.15 };
  const byType = new Map(coverage.map((r) => [r.reportType, r]));
  let sum = 0;
  for (const [type, w] of Object.entries(weights)) {
    const row = byType.get(type);
    const credit = row?.readinessStatus === "ready" ? 1 : row?.readinessStatus === "partial" ? 0.5 : 0;
    sum += credit * w;
  }
  return Math.round(sum * 100);
}

describe("knowledgeHealthEngine", () => {
  it("detects health query focus", () => {
    expect(detectKnowledgeHealthFocus("health check")).toBe("general");
    expect(detectKnowledgeHealthFocus("dashboard readiness")).toBe("dashboard");
    expect(detectKnowledgeHealthFocus("what am I missing")).toBe("missing");
    expect(detectKnowledgeHealthFocus("why is confidence low")).toBe("confidence");
  });

  it("gives period-gap credit when reception files exist but coverage dates are null", () => {
    const result = scoreCoverageCompleteness(khobarJuneSnapshot.coverage, {
      fileInventory: { reception_daily_report: 11, daily_briefing: 14 },
    });
    expect(result.periodGapTypes.map((g) => g.reportType)).toEqual(
      expect.arrayContaining(["reception_daily_report", "daily_briefing"]),
    );
    expect(result.score).toBeGreaterThan(legacyCoverageScore(khobarJuneSnapshot.coverage, {}));
  });

  it("does not penalize executive readiness for missing guest feedback", () => {
    const result = assessExecutiveIntelligenceReadiness({
      coverage: khobarJuneSnapshot.coverage,
      guestFeedbackCoverage: [],
      fileInventory: khobarJuneSnapshot.fileInventory,
    });
    expect(result.confidenceReductionReasons.some((r) => /guest feedback/i.test(r))).toBe(false);
    expect(result.optionalInactive.some((r) => /guest feedback/i.test(r))).toBe(true);
    expect(result.score).toBeGreaterThan(legacyExecutiveScore(khobarJuneSnapshot.coverage));
  });

  it("reports dashboard history depth without scoring penalty", () => {
    const result = assessDashboardReadiness(khobarJuneSnapshot);
    expect(result.score).toBe(70);
    expect(result.missing).not.toContain("Historical weekly dashboard");
    expect(result.dashboardHistoryDepth.fileCount).toBe(2);
    expect(result.dashboardHistoryDepth.informational).toBe(true);
  });

  it("flags only required reports in missing registry", () => {
    const registry = buildMissingInformationRegistry({
      ...khobarJuneSnapshot,
      periodGapTypes: [
        { reportType: "reception_daily_report", label: "Reception Daily Report", fileCount: 11, reason: "period gap" },
      ],
    });
    expect(registry.missingReports.some((r) => /reception/i.test(r.label))).toBe(false);
    expect(registry.informationalGaps.some((g) => /reception/i.test(g.label))).toBe(true);
  });

  it("calibrated Khobar June health is higher than legacy weighting", () => {
    const health = computeKnowledgeHealth(khobarJuneSnapshot);
    expect(health.overallScore).toBeGreaterThanOrEqual(60);
    expect(health.components.executiveIntelligenceReadiness).toBeGreaterThanOrEqual(75);
    expect(health.components.coverageCompleteness).toBeGreaterThanOrEqual(70);
  });

  it("includes domain readiness placeholders without changing overall score", () => {
    const health = computeKnowledgeHealth(khobarJuneSnapshot);
    expect(health.domainReadiness).toHaveLength(6);
    expect(health.domainReadiness.find((d) => d.domain === "operations")?.status).toBe("production_scored");
    expect(health.domainReadiness.find((d) => d.domain === "food_safety")?.status).toBe("not_yet_parseable");
  });
});
