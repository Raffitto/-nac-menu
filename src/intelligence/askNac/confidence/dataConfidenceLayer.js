/**
 * Ask NAC data confidence layer — business coverage before answering.
 */

import { GOOGLE_PLACE_BRANCHES } from "../../../dashboard/config/googleBranchPlaces";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { normalizeBranchId } from "../../../dashboard/utils/branchIdentity";
import { CONFIDENCE } from "../../../platform/contracts/dataConfidence";
import { fetchUnifiedReviewTruth } from "../../../lib/unifiedReviewTruth";
import { fetchGoogleReviewSnapshots } from "../../../dashboard/utils/googleReviewSnapshotHistory";
import { probeFoodicsBatchForPeriod } from "../foodics/foodicsQueryTools";
import { getVaultCoverage } from "../vault/vaultQueryTools";
import { MONTH_HOURS } from "../../../dashboard/utils/rangeState";

export const DATA_SOURCE_KEYS = Object.freeze([
  "reviews",
  "googleSnapshots",
  "qrScans",
  "foodicsSales",
  "dailyLogbooks",
  "receptionReports",
  "audits",
  "operationalFiles",
]);

const VAULT_TYPE_MAP = Object.freeze({
  dailyLogbooks: "daily_logbook",
  receptionReports: "reception_daily_report",
  audits: "ccm_reconciliation",
});

const RANKING_ANALYSIS_KINDS = new Set([
  "best_overall",
  "google_maps",
  "improved_most",
  "needs_attention",
  "general",
]);

function clampScore(n) {
  return Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return clampScore((numerator / denominator) * 100);
}

function monthPeriodBounds(reference = new Date()) {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

function emptyBranchSources(branchId) {
  return Object.fromEntries(
    DATA_SOURCE_KEYS.map((key) => [key, { available: false, detail: null }]),
  );
}

function markBranchSource(branchMap, branchId, key, detail) {
  const id = normalizeBranchId(branchId);
  if (!id || !branchMap[id]) return;
  branchMap[id][key] = { available: true, detail: detail || "available" };
}

function countAvailableSources(branchSources) {
  return DATA_SOURCE_KEYS.filter((key) => branchSources[key]?.available).length;
}

function branchHasMeaningfulCoverage(branchSources) {
  const operational =
    branchSources.qrScans?.available ||
    branchSources.reviews?.available ||
    branchSources.googleSnapshots?.available;
  const vault =
    branchSources.dailyLogbooks?.available ||
    branchSources.receptionReports?.available ||
    branchSources.operationalFiles?.available;
  return operational || vault;
}

export function scoreCoverageDimensions(branchCoverageRows = []) {
  const branches = branchCoverageRows.length ? branchCoverageRows : [];
  const meaningfulBranches = branches.filter((row) => row.meaningful).length;
  const branchCount = Math.max(branches.length, GOOGLE_PLACE_BRANCHES.length);

  const sourceTotals = Object.fromEntries(DATA_SOURCE_KEYS.map((key) => [key, 0]));
  branches.forEach((row) => {
    DATA_SOURCE_KEYS.forEach((key) => {
      if (row.sources?.[key]?.available) sourceTotals[key] += 1;
    });
  });

  const dataCoverageScore = pct(
    Object.values(sourceTotals).reduce((sum, n) => sum + n, 0),
    DATA_SOURCE_KEYS.length * branchCount,
  );
  const branchCoverageScore = pct(meaningfulBranches, branchCount);
  const timeCoverageScore = pct(
    branches.filter((row) => row.timeCoverage).length,
    branchCount,
  );
  const sourceCoverageScore = pct(
    DATA_SOURCE_KEYS.filter((key) => sourceTotals[key] > 0).length,
    DATA_SOURCE_KEYS.length,
  );

  return {
    dataCoverageScore,
    branchCoverageScore,
    timeCoverageScore,
    sourceCoverageScore,
  };
}

export function confidenceLevelFromScores(scores, { meaningfulBranchCount = 0 } = {}) {
  const dims = [
    scores.dataCoverageScore,
    scores.branchCoverageScore,
    scores.timeCoverageScore,
    scores.sourceCoverageScore,
  ];
  const avg = dims.reduce((sum, n) => sum + n, 0) / dims.length;

  if (avg >= 70 && meaningfulBranchCount >= 2) return CONFIDENCE.HIGH;
  if (avg >= 45 && meaningfulBranchCount >= 1) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

export function requiresExecutiveRankingSafeguard(analysisKind = "general") {
  return RANKING_ANALYSIS_KINDS.has(analysisKind);
}

export function evaluateExecutiveRankingEligibility(coverageAssessment, analysisKind = "general") {
  if (!requiresExecutiveRankingSafeguard(analysisKind)) {
    return { allowed: true, reason: null };
  }

  const meaningful = coverageAssessment?.meaningfulBranchCount || 0;
  if (meaningful >= 2) {
    return { allowed: true, reason: null };
  }

  return {
    allowed: false,
    reason:
      meaningful === 1
        ? "Only one branch has meaningful coverage — network rankings require at least two branches."
        : "Insufficient data for a valid network-wide comparison.",
  };
}

export function buildCoverageRecommendation(coverageAssessment) {
  const missing = coverageAssessment?.missingSources || [];
  if (!missing.length) {
    return "Coverage is sufficient for the requested analysis — continue uploading daily operational files to strengthen confidence.";
  }
  if (missing.includes("googleSnapshots")) {
    return "Capture daily Google review snapshots from Intelligence dashboards to unlock growth and Maps comparisons.";
  }
  if (missing.some((item) => item.startsWith("vault:"))) {
    return "Upload daily logbooks, reception reports, and cash-up files for the period you want Ask NAC to explain.";
  }
  return "Increase card-handoff activity and upload operational reports to improve network confidence.";
}

function summarizeMissingSources(branchCoverageRows = []) {
  const missing = new Set();
  const totals = Object.fromEntries(DATA_SOURCE_KEYS.map((key) => [key, 0]));

  branchCoverageRows.forEach((row) => {
    DATA_SOURCE_KEYS.forEach((key) => {
      if (row.sources?.[key]?.available) totals[key] += 1;
      else missing.add(key);
    });
  });

  const labels = {
    reviews: "Review funnel events",
    googleSnapshots: "Google review snapshots",
    qrScans: "QR scan activity",
    foodicsSales: "Foodics sales imports",
    dailyLogbooks: "Daily logbooks",
    receptionReports: "Reception reports",
    audits: "Audit / CCM reconciliation files",
    operationalFiles: "Uploaded operational vault files",
  };

  return [...missing].map((key) => labels[key] || key);
}

/**
 * Assess network data confidence before executive / cross-source answers.
 */
export async function assessNetworkDataConfidence(supabase, context = {}) {
  const hours = Number(context.hours) || MONTH_HOURS;
  const { startDate, endDate } = context.periodBounds || monthPeriodBounds();
  const branchMap = Object.fromEntries(
    GOOGLE_PLACE_BRANCHES.map((id) => [id, emptyBranchSources(id)]),
  );

  let reviewComparison = [];
  if (supabase) {
    const truth = await fetchUnifiedReviewTruth(supabase, {
      hours,
      profile: context.profile,
      branch: null,
    }).catch(() => null);
    reviewComparison = truth?.branchComparison || [];
    reviewComparison.forEach((row) => {
      const id = normalizeBranchId(row.branch_id);
      if (!id) return;
      if (Number(row.qr_scans) > 0) markBranchSource(branchMap, id, "qrScans", `${row.qr_scans} QR scans`);
      if (Number(row.google_redirects) > 0 || Number(row.reviews_generated) > 0) {
        markBranchSource(branchMap, id, "reviews", `${row.google_redirects || 0} redirects`);
      }
    });
  }

  const { data: snapshots = [] } = supabase
    ? await fetchGoogleReviewSnapshots().catch(() => ({ data: [] }))
    : { data: [] };

  snapshots.forEach((snap) => {
    const id = normalizeBranchId(snap.branch_id);
    if (!id) return;
    markBranchSource(
      branchMap,
      id,
      "googleSnapshots",
      snap.review_count != null ? `${snap.review_count} reviews tracked` : "snapshot stored",
    );
  });

  if (supabase) {
    for (const branchId of GOOGLE_PLACE_BRANCHES) {
      const foodics = await probeFoodicsBatchForPeriod(supabase, {
        branch: branchId,
        startDate,
        endDate,
        profile: context.profile,
      }).catch(() => null);
      if (foodics?.hasBatch) {
        markBranchSource(branchMap, branchId, "foodicsSales", foodics.batchCoverage || "Foodics batch");
      }
    }

    const vaultCoverage = await getVaultCoverage(supabase, {
      startDate,
      endDate,
      profile: context.profile,
    }).catch(() => ({ coverage: [] }));

    (vaultCoverage.coverage || []).forEach((row) => {
      const id = normalizeBranchId(row.branchId);
      if (!id) return;
      if (row.readinessStatus === "ready" || row.readinessStatus === "partial") {
        markBranchSource(branchMap, id, "operationalFiles", row.reportType);
      }
      if (row.reportType === VAULT_TYPE_MAP.dailyLogbooks) {
        markBranchSource(branchMap, id, "dailyLogbooks", row.fileTitle);
      }
      if (row.reportType === VAULT_TYPE_MAP.receptionReports) {
        markBranchSource(branchMap, id, "receptionReports", row.fileTitle);
      }
      if (row.reportType === VAULT_TYPE_MAP.audits) {
        markBranchSource(branchMap, id, "audits", row.fileTitle);
      }
    });
  }

  const branchCoverage = GOOGLE_PLACE_BRANCHES.map((branchId) => {
    const sources = branchMap[branchId] || emptyBranchSources(branchId);
    const meaningful = branchHasMeaningfulCoverage(sources);
    const timeCoverage = Boolean(sources.googleSnapshots?.available || sources.foodicsSales?.available);
    return {
      branch_id: branchId,
      branch_name: branchDisplayName(branchId),
      sources,
      availableSourceCount: countAvailableSources(sources),
      meaningful,
      timeCoverage,
    };
  });

  const meaningfulBranchCount = branchCoverage.filter((row) => row.meaningful).length;
  const scores = scoreCoverageDimensions(branchCoverage);
  const confidenceLevel = confidenceLevelFromScores(scores, { meaningfulBranchCount });
  const missingSources = summarizeMissingSources(branchCoverage);

  return {
    ...scores,
    confidenceLevel,
    branchCoverage,
    meaningfulBranchCount,
    missingSources,
    recommendation: buildCoverageRecommendation({ missingSources }),
    period: { startDate, endDate, hours },
  };
}
