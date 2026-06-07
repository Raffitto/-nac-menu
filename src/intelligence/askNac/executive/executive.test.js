import {
  routeAskNacIntent,
  ASK_NAC_INTENTS,
  detectExecutiveAnalysisKind,
} from "../intentRouter";
import {
  buildExecutiveBranchScore,
  buildExecutiveSummary,
  calculateReviewGrowth,
  calculateReviewGrowthRows,
  calculateBranchMomentum,
} from "./executiveMetrics";
import { buildDeterministicAskNacAnswer } from "../answerBuilder";
import { READINESS } from "../readinessEngine";

describe("executive intent routing", () => {
  test("routes best branch overall", () => {
    const route = routeAskNacIntent("Which branch is performing best overall?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS);
    expect(route.executiveKind).toBe("best_overall");
  });

  test("routes Google Maps performance question", () => {
    const route = routeAskNacIntent("Which branch is performing better overall in Google Maps?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS);
    expect(route.executiveKind).toBe("google_maps");
  });

  test("routes stars gained question", () => {
    const route = routeAskNacIntent("How many stars have we gained since follow-up started?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS);
    expect(route.executiveKind).toBe("stars_gained");
  });

  test("routes management focus question", () => {
    const route = routeAskNacIntent("What should I focus on this week?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS);
    expect(route.executiveKind).toBe("management_focus");
  });

  test("routes branch momentum question", () => {
    const route = routeAskNacIntent("Which branch improved the most?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS);
    expect(detectExecutiveAnalysisKind("Which branch improved the most?")).toBe("improved_most");
  });
});

describe("executive metrics", () => {
  test("buildExecutiveBranchScore returns normalized components", () => {
    const row = buildExecutiveBranchScore({
      branchId: "khobar",
      branchRow: {
        branch_id: "khobar",
        qr_scans: 120,
        google_redirects: 40,
        conversion_pct: 33,
      },
      googleMovement: {
        branch_id: "khobar",
        current_rating: 4.5,
        month_delta: 8,
        period_delta: 8,
      },
      networkMaxScans: 120,
      networkMaxRedirects: 40,
      staff: [{ name: "Ali", scans: 20, google: 10 }],
    });

    expect(row.branch_name).toBe("Khobar");
    expect(row.score).toBeGreaterThan(0);
    expect(row.components.googleRatingScore).toBeGreaterThan(0);
    expect(row.components.reviewGrowthScore).toBeGreaterThan(50);
    expect(row.strengths.length + row.risks.length).toBeGreaterThan(0);
  });

  test("calculateReviewGrowth scores positive deltas higher", () => {
    expect(calculateReviewGrowth({ month_delta: 15 })).toBeGreaterThan(
      calculateReviewGrowth({ month_delta: 0 }),
    );
  });

  test("calculateReviewGrowthRows computes baseline growth", () => {
    const rows = calculateReviewGrowthRows({
      khobar: {
        branch_id: "khobar",
        branch_name: "Khobar",
        baseline_count: 100,
        current_review_count: 112,
      },
    });
    expect(rows[0].growth).toBe(12);
    expect(rows[0].growthPct).toBe(12);
  });

  test("calculateBranchMomentum blends growth and impact", () => {
    const momentum = calculateBranchMomentum(
      { month_delta: 10, week_delta: 3 },
      { google_redirects: 20, qr_scans: 50, conversion_pct: 40 },
    );
    expect(momentum).toBeGreaterThan(50);
  });

  test("buildExecutiveSummary returns winner for best overall", () => {
    const summary = buildExecutiveSummary({
      analysisKind: "best_overall",
      branchScores: [
        {
          branch_id: "riyadh",
          branch_name: "Riyadh",
          score: 82,
          strengths: ["Strong redirect conversion"],
          risks: [],
          components: { reviewGrowthScore: 80 },
        },
        {
          branch_id: "khobar",
          branch_name: "Khobar",
          score: 68,
          strengths: [],
          risks: ["Low card-handoff volume"],
          components: { reviewGrowthScore: 55 },
        },
      ],
    });
    expect(summary.headline).toMatch(/Riyadh/i);
    expect(summary.winner).toBe("Riyadh");
    expect(summary.rankingTable.length).toBeGreaterThan(0);
  });

  test("buildExecutiveSummary returns priorities for management focus", () => {
    const summary = buildExecutiveSummary({
      analysisKind: "management_focus",
      branchScores: [
        { branch_id: "khobar", branch_name: "Khobar", score: 90, strengths: [], risks: [] },
        { branch_id: "jeddah", branch_name: "Jeddah", score: 45, strengths: [], risks: ["Weak conversion"] },
      ],
      commandCenter: { dailyBrief: { coaching_focus: "Coach redirect handoffs at bill close." } },
    });
    expect(summary.recommendedActions.length).toBeGreaterThan(0);
    expect(summary.headline).toMatch(/Jeddah|focus|Strengthen/i);
  });
});

describe("executive answer builder", () => {
  test("builds executive answer with ranking and actions", () => {
    const route = routeAskNacIntent("Which branch is performing best overall?");
    const answer = buildDeterministicAskNacAnswer(
      route,
      {
        periodLabel: "This month",
        analysisKind: "best_overall",
        summary: {
          headline: "Riyadh is performing best overall with an executive score of 82.",
          winner: "Riyadh",
          reason: "Strong redirect conversion",
          rankingTable: [
            { rank: 1, branch: "Riyadh", score: 82, strengths: "Strong conversion", risks: "—" },
          ],
          keyFindings: ["Riyadh leads on composite Google Maps and redirect performance."],
          recommendedActions: ["Coach Jeddah using Riyadh playbooks."],
        },
        sources: [{ name: "operationalScoreEngine", detail: "deterministic" }],
        warnings: [],
      },
      { status: READINESS.READY, canQuery: true },
    );

    expect(answer.answerType).toBe("executive");
    expect(answer.directAnswer).toMatch(/Riyadh/i);
    expect(answer.executiveSummary.ranking.length).toBeGreaterThan(0);
    expect(answer.recommendations.length).toBeGreaterThan(0);
  });

  test("blocks executive ranking with insufficient branch coverage", () => {
    const route = routeAskNacIntent("Which branch is performing best overall?");
    const answer = buildDeterministicAskNacAnswer(
      route,
      {
        periodLabel: "This month",
        analysisKind: "best_overall",
        coverageBlocked: true,
        rankingEligibility: {
          allowed: false,
          reason: "Insufficient data for a valid network-wide comparison.",
        },
        coverageAssessment: {
          confidenceLevel: "low",
          branchCoverage: [
            { branch_name: "Khobar", availableSourceCount: 2, meaningful: true },
            { branch_name: "Riyadh", availableSourceCount: 0, meaningful: false },
          ],
          missingSources: ["googleSnapshots"],
          recommendation: "Capture daily Google snapshots.",
          dataCoverageScore: 20,
          branchCoverageScore: 33,
          timeCoverageScore: 10,
          sourceCoverageScore: 25,
        },
        summary: {
          headline: "Insufficient data for a valid network-wide comparison.",
          keyFindings: ["Khobar: 2/8 sources available"],
          recommendedActions: ["Capture daily Google snapshots."],
          rankingTable: [],
        },
        sources: [{ name: "dataConfidenceLayer", detail: "coverage" }],
        warnings: [],
      },
      { status: READINESS.READY, canQuery: true },
    );

    expect(answer.directAnswer).toMatch(/Insufficient data/i);
    expect(answer.executiveSummary.ranking).toHaveLength(0);
    expect(answer.dataConfidence.branchCoverage.length).toBeGreaterThan(0);
  });
});
