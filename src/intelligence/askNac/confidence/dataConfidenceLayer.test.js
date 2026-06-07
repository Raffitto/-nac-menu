import {
  scoreCoverageDimensions,
  confidenceLevelFromScores,
  evaluateExecutiveRankingEligibility,
  requiresExecutiveRankingSafeguard,
  buildCoverageRecommendation,
} from "./dataConfidenceLayer";
import { CONFIDENCE } from "../../../platform/contracts/dataConfidence";

describe("dataConfidenceLayer", () => {
  test("scores coverage dimensions from branch rows", () => {
    const scores = scoreCoverageDimensions([
      {
        meaningful: true,
        timeCoverage: true,
        sources: {
          reviews: { available: true },
          googleSnapshots: { available: true },
          qrScans: { available: true },
          foodicsSales: { available: false },
          dailyLogbooks: { available: false },
          receptionReports: { available: false },
          audits: { available: false },
          operationalFiles: { available: false },
        },
      },
      {
        meaningful: true,
        timeCoverage: true,
        sources: {
          reviews: { available: true },
          googleSnapshots: { available: true },
          qrScans: { available: true },
          foodicsSales: { available: true },
          dailyLogbooks: { available: true },
          receptionReports: { available: false },
          audits: { available: false },
          operationalFiles: { available: true },
        },
      },
    ]);

    expect(scores.dataCoverageScore).toBeGreaterThan(0);
    expect(scores.branchCoverageScore).toBe(67);
  });

  test("returns high confidence with two meaningful branches", () => {
    const scores = scoreCoverageDimensions([
      {
        meaningful: true,
        timeCoverage: true,
        sources: {
          reviews: { available: true },
          googleSnapshots: { available: true },
          qrScans: { available: true },
          foodicsSales: { available: true },
          dailyLogbooks: { available: true },
          receptionReports: { available: true },
          audits: { available: false },
          operationalFiles: { available: true },
        },
      },
      {
        meaningful: true,
        timeCoverage: true,
        sources: {
          reviews: { available: true },
          googleSnapshots: { available: true },
          qrScans: { available: true },
          foodicsSales: { available: true },
          dailyLogbooks: { available: true },
          receptionReports: { available: true },
          audits: { available: true },
          operationalFiles: { available: true },
        },
      },
    ]);
    expect(confidenceLevelFromScores(scores, { meaningfulBranchCount: 2 })).toBe(CONFIDENCE.HIGH);
  });

  test("blocks executive ranking when fewer than two branches have coverage", () => {
    const eligibility = evaluateExecutiveRankingEligibility(
      { meaningfulBranchCount: 0 },
      "best_overall",
    );
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.reason).toMatch(/network-wide comparison/i);
  });

  test("allows management focus without ranking safeguard", () => {
    expect(requiresExecutiveRankingSafeguard("management_focus")).toBe(false);
  });

  test("builds actionable recommendation for missing snapshots", () => {
    const recommendation = buildCoverageRecommendation({ missingSources: ["googleSnapshots"] });
    expect(recommendation).toMatch(/snapshot/i);
  });
});
