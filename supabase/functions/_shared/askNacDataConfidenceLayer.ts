/**
 * Ask NAC data confidence layer — business coverage before executive answers (Edge).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { MONTH_HOURS } from "./mtdHybridMerge.ts";
import { branchDisplayName } from "./askNacEdgeAnswerBuilder.ts";
import { getBatchForExportPeriod, DEFAULT_IMPORT_TYPE } from "./askNacFoodicsTools.ts";
import { getVaultCoverage } from "./askNacVaultTools.ts";

export const DATA_SOURCE_KEYS = [
  "reviews",
  "googleSnapshots",
  "qrScans",
  "foodicsSales",
  "dailyLogbooks",
  "receptionReports",
  "audits",
  "operationalFiles",
] as const;

const BRANCH_IDS = ["khobar", "riyadh", "jeddah"];

const VAULT_TYPE_MAP: Record<string, string> = {
  dailyLogbooks: "daily_logbook",
  receptionReports: "reception_daily_report",
  audits: "ccm_reconciliation",
};

const RANKING_ANALYSIS_KINDS = new Set([
  "best_overall",
  "google_maps",
  "improved_most",
  "needs_attention",
  "general",
]);

function clampScore(n: number) {
  return Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
}

function pct(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return clampScore((numerator / denominator) * 100);
}

function monthPeriodBounds(reference = new Date()) {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

function emptyBranchSources() {
  return Object.fromEntries(
    DATA_SOURCE_KEYS.map((key) => [key, { available: false, detail: null }]),
  ) as Record<string, { available: boolean; detail: string | null }>;
}

function markBranchSource(
  branchMap: Record<string, Record<string, { available: boolean; detail: string | null }>>,
  branchId: string,
  key: string,
  detail: string,
) {
  const id = String(branchId || "").toLowerCase();
  if (!id || !branchMap[id]) return;
  branchMap[id][key] = { available: true, detail: detail || "available" };
}

function countAvailableSources(branchSources: Record<string, { available: boolean }>) {
  return DATA_SOURCE_KEYS.filter((key) => branchSources[key]?.available).length;
}

function branchHasMeaningfulCoverage(branchSources: Record<string, { available: boolean }>) {
  const operational =
    branchSources.qrScans?.available ||
    branchSources.reviews?.available ||
    branchSources.googleSnapshots?.available;
  const vault =
    branchSources.dailyLogbooks?.available ||
    branchSources.receptionReports?.available ||
    branchSources.operationalFiles?.available;
  return Boolean(operational || vault);
}

export function scoreCoverageDimensions(branchCoverageRows: Record<string, unknown>[] = []) {
  const branches = branchCoverageRows.length ? branchCoverageRows : [];
  const meaningfulBranches = branches.filter((row) => row.meaningful).length;
  const branchCount = Math.max(branches.length, BRANCH_IDS.length);

  const sourceTotals = Object.fromEntries(DATA_SOURCE_KEYS.map((key) => [key, 0])) as Record<string, number>;
  branches.forEach((row) => {
    const sources = row.sources as Record<string, { available: boolean }> | undefined;
    DATA_SOURCE_KEYS.forEach((key) => {
      if (sources?.[key]?.available) sourceTotals[key] += 1;
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

  return { dataCoverageScore, branchCoverageScore, timeCoverageScore, sourceCoverageScore };
}

export function confidenceLevelFromScores(
  scores: ReturnType<typeof scoreCoverageDimensions>,
  { meaningfulBranchCount = 0 } = {},
) {
  const dims = [
    scores.dataCoverageScore,
    scores.branchCoverageScore,
    scores.timeCoverageScore,
    scores.sourceCoverageScore,
  ];
  const avg = dims.reduce((sum, n) => sum + n, 0) / dims.length;

  if (avg >= 70 && meaningfulBranchCount >= 2) return "high";
  if (avg >= 45 && meaningfulBranchCount >= 1) return "medium";
  return "low";
}

export function requiresExecutiveRankingSafeguard(analysisKind = "general") {
  return RANKING_ANALYSIS_KINDS.has(analysisKind);
}

export function evaluateExecutiveRankingEligibility(
  coverageAssessment: Record<string, unknown> | null | undefined,
  analysisKind = "general",
) {
  if (!requiresExecutiveRankingSafeguard(analysisKind)) {
    return { allowed: true, reason: null };
  }

  const meaningful = Number(coverageAssessment?.meaningfulBranchCount) || 0;
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

export function buildCoverageRecommendation(coverageAssessment: { missingSources?: string[] } = {}) {
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

function summarizeMissingSources(branchCoverageRows: Record<string, unknown>[] = []) {
  const missing = new Set<string>();
  branchCoverageRows.forEach((row) => {
    const sources = row.sources as Record<string, { available: boolean }> | undefined;
    DATA_SOURCE_KEYS.forEach((key) => {
      if (sources?.[key]?.available) return;
      missing.add(key);
    });
  });

  const labels: Record<string, string> = {
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

export async function assessNetworkDataConfidence(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const hours = Number(context.hours) || MONTH_HOURS;
  const { startDate, endDate } = (context.periodBounds as { startDate: string; endDate: string }) || monthPeriodBounds();
  const branchMap = Object.fromEntries(BRANCH_IDS.map((id) => [id, emptyBranchSources()])) as Record<
    string,
    Record<string, { available: boolean; detail: string | null }>
  >;

  const { data: reviewSummary, error: reviewError } = await supabase.rpc("get_review_events_summary", {
    p_branch: null,
    p_hours: hours,
  });
  if (!reviewError) {
    const row = Array.isArray(reviewSummary) ? reviewSummary[0] : reviewSummary;
    const byBranch = Array.isArray(row?.by_branch) ? row.by_branch : [];
    byBranch.forEach((branchRow: Record<string, unknown>) => {
      const id = String(branchRow.branch_id || "").toLowerCase();
      if (!id) return;
      if (Number(branchRow.qr_scans) > 0) {
        markBranchSource(branchMap, id, "qrScans", `${branchRow.qr_scans} QR scans`);
      }
      if (Number(branchRow.google_redirects) > 0 || Number(branchRow.reviews_generated) > 0) {
        markBranchSource(branchMap, id, "reviews", `${branchRow.google_redirects || 0} redirects`);
      }
    });
  }

  const { data: snapshots = [] } = await supabase
    .from("google_review_snapshots")
    .select("branch_id, review_count")
    .in("branch_id", BRANCH_IDS);

  (snapshots || []).forEach((snap: Record<string, unknown>) => {
    const id = String(snap.branch_id || "").toLowerCase();
    if (!id) return;
    markBranchSource(
      branchMap,
      id,
      "googleSnapshots",
      snap.review_count != null ? `${snap.review_count} reviews tracked` : "snapshot stored",
    );
  });

  for (const branchId of BRANCH_IDS) {
    const batch = await getBatchForExportPeriod(supabase, DEFAULT_IMPORT_TYPE, branchId, startDate, endDate).catch(
      () => null,
    );
    if (batch) {
      markBranchSource(branchMap, branchId, "foodicsSales", batch.source_file_name || "Foodics batch");
    }
  }

  const vaultCoverage = await getVaultCoverage(supabase, {
    startDate,
    endDate,
    profile: context.profile,
  }).catch(() => ({ coverage: [] as Record<string, unknown>[] }));

  (vaultCoverage.coverage || []).forEach((row: Record<string, unknown>) => {
    const id = String(row.branchId || row.branch_id || "").toLowerCase();
    if (!id) return;
    if (row.readinessStatus === "ready" || row.readinessStatus === "partial") {
      markBranchSource(branchMap, id, "operationalFiles", String(row.reportType || "vault file"));
    }
    if (row.reportType === VAULT_TYPE_MAP.dailyLogbooks) {
      markBranchSource(branchMap, id, "dailyLogbooks", String(row.fileTitle || "daily logbook"));
    }
    if (row.reportType === VAULT_TYPE_MAP.receptionReports) {
      markBranchSource(branchMap, id, "receptionReports", String(row.fileTitle || "reception report"));
    }
    if (row.reportType === VAULT_TYPE_MAP.audits) {
      markBranchSource(branchMap, id, "audits", String(row.fileTitle || "audit"));
    }
  });

  const branchCoverage = BRANCH_IDS.map((branchId) => {
    const sources = branchMap[branchId] || emptyBranchSources();
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
