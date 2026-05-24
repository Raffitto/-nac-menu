/**
 * Truth Validation — orchestrates confidence, integrity, anomalies, health, checklist.
 */

import { assessMenuBiConfidence, assessPredictiveConfidence } from "./dataConfidenceEngine";
import { buildAnalyticsIntegrityReport } from "./analyticsIntegrityEngine";
import { detectAnomalies } from "./anomalyDetectionEngine";
import { computePlatformHealthScore } from "./platformHealthScoreEngine";
import { runValidationChecklist } from "./validationChecklistEngine";
import { formatFreshnessSnapshot, getDataFreshness } from "./dataFreshnessEngine";
import { getPipelineDiagnostics } from "../../lib/pipelineDiagnostics";
import { computeOperationalTrustScore } from "./reportTruthEngine";

/**
 * @param {object} input
 */
export function buildTruthValidationPackage(input = {}) {
  const {
    biData = null,
    rangeContract = null,
    dataSource = null,
    liveFallback = false,
    partial = false,
    sufficiency = null,
    reviewKpis = null,
    predictivePkg = null,
    tracking = null,
    fetchHistory = null,
    freshnessRaw = null,
    observations = null,
    buildId = null,
    importIntegrity = null,
    totalSessions = 0,
  } = input;

  const pipeline = getPipelineDiagnostics();
  const trackingSnap = tracking || pipeline.tracking;
  const history = fetchHistory || pipeline.fetchHistory || [];

  const menuConfidence = assessMenuBiConfidence({
    data: biData,
    rangeContract,
    dataSource,
    liveFallback,
    partial,
    sufficiency,
    tracking: trackingSnap,
  });

  const predictiveConfidence = assessPredictiveConfidence({
    pkg: predictivePkg,
    reviewKpis,
    selectedRange: rangeContract?.id,
  });

  const integrity = buildAnalyticsIntegrityReport({
    biData,
    tracking: trackingSnap,
    dataSource,
    liveFallback,
    sufficiency,
    reviewKpis,
  });

  const freshness = formatFreshnessSnapshot(freshnessRaw || getDataFreshness());

  const anomalyReport = detectAnomalies({
    biData,
    tracking: trackingSnap,
    fetchHistory: history,
    freshness,
    buildId,
  });

  const healthScore = computePlatformHealthScore({
    integrity,
    sufficiency,
    confidence: menuConfidence,
    freshness,
    dataSource,
    rangeContract,
    anomalyReport,
  });

  const checklist = runValidationChecklist({ biData, observations });

  const operationalTrust = computeOperationalTrustScore({
    importIntegrity,
    trackingIntegrity: { score: integrity?.score ?? 70 },
    attributionConfidence: { score: menuConfidence?.score ?? 55 },
    branchCoverage: { score: biData?.by_branch ? 78 : 60 },
    sessionDensity: {
      score: Math.min(100, Math.round((totalSessions || biData?.total_sessions || 0) * 1.2)),
    },
    visibilityConfidence: { score: menuConfidence?.score ?? 60 },
  });

  return {
    menuConfidence,
    predictiveConfidence,
    integrity,
    freshness,
    anomalies: anomalyReport,
    healthScore,
    checklist,
    operationalTrust,
    generated_at: new Date().toISOString(),
  };
}
