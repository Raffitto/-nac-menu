/**
 * Knowledge Health Engine tests — scoring from registry signals only.
 */

import {
  computeKnowledgeHealth,
  detectKnowledgeHealthFocus,
  scoreCoverageCompleteness,
  assessDashboardReadiness,
  assessExecutiveIntelligenceReadiness,
  buildMissingInformationRegistry,
} from "./knowledgeHealthEngine";

describe("knowledgeHealthEngine", () => {
  const baseCoverage = [
    { reportType: "cash_up", readinessStatus: "ready", factCount: 120 },
    { reportType: "daily_logbook", readinessStatus: "partial", factCount: 8 },
    { reportType: "daily_briefing", readinessStatus: "registered", factCount: 0 },
  ];

  it("detects health query focus", () => {
    expect(detectKnowledgeHealthFocus("health check")).toBe("general");
    expect(detectKnowledgeHealthFocus("dashboard readiness")).toBe("dashboard");
    expect(detectKnowledgeHealthFocus("what am I missing")).toBe("missing");
    expect(detectKnowledgeHealthFocus("why is confidence low")).toBe("confidence");
  });

  it("scores coverage from readiness_status and fact_count", () => {
    const result = scoreCoverageCompleteness(baseCoverage);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
    expect(result.missingTypes).toContain("reception_daily_report");
  });

  it("assesses dashboard readiness without fabricating manual inputs", () => {
    const result = assessDashboardReadiness({
      weekAggregation: { dayCount: 7, totalSales: 10000 },
      manualInputs: [],
      logbookFacts: [{ dimensions: { text_value: "Terrace busy at lunch" } }],
      googleReviewFacts: [{ metric_key: "google_review_5", metric_value: 3 }],
    });
    expect(result.score).toBeLessThan(100);
    expect(result.missing).toContain("7Rooms covers");
  });

  it("flags executive confidence reduction when briefing missing", () => {
    const result = assessExecutiveIntelligenceReadiness({ coverage: baseCoverage });
    expect(result.confidenceReductionReasons.some((r) => /briefing|feedback|dashboard/i.test(r))).toBe(true);
  });

  it("builds missing information registry from real tables", () => {
    const registry = buildMissingInformationRegistry({
      coverage: baseCoverage,
      ingestionJobs: [{ status: "failed", error: "parse error", fileTitle: "Cash Up.xlsx" }],
      pendingSessions: [{ session_type: "weekly_dashboard", missing_fields: [{ label: "7Rooms covers" }] }],
      discoveryCandidates: [{ folder_path: "/Guest Feedback", detected_report_type: "guest_feedback", recommended_action: "ask", status: "pending" }],
      periodLabel: "June 2026",
    });
    expect(registry.missingReports.length).toBeGreaterThan(0);
    expect(registry.failedExtractions.length).toBe(1);
    expect(registry.pendingSessions.length).toBe(1);
    expect(registry.unapprovedFolders.length).toBe(1);
  });

  it("computes overall health score with ingestion disclosure when no jobs", () => {
    const health = computeKnowledgeHealth({
      branch: "khobar",
      branchLabel: "Khobar",
      periodLabel: "June 2026",
      coverage: baseCoverage,
      ingestionJobs: [],
      weekAggregation: { dayCount: 5, totalSales: 8000 },
      logbookFacts: [],
      googleReviewFacts: [],
      manualInputs: [],
      pendingSessions: [],
      discoveryCandidates: [],
      historicalDashboardCoverage: [],
    });
    expect(health.overallScore).toBeGreaterThanOrEqual(0);
    expect(health.overallScore).toBeLessThanOrEqual(100);
    expect(health.disclosures.some((d) => /ingestion_jobs/i.test(d))).toBe(true);
    expect(health.recommendations.length).toBeGreaterThan(0);
  });
});
