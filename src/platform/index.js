/**
 * NAC OS — shared intelligence platform layer.
 * Import from here in new code; legacy paths re-export for compatibility.
 */

export * from "./contracts/intelligenceRangeContract";
export * from "./contracts/platformStatusContract";
export * from "./contracts/dataSufficiency";
export * from "./contracts/dataConfidence";
export * from "./contracts/validationChecklist";
export * from "./contracts/reportTruthContract";

export * from "./engines/branchIdentityEngine";
export * from "./engines/businessDayEngine";
export * from "./engines/timeRangeEngine";
export * from "./engines/funnelAnalyticsEngine";
export * from "./engines/sessionBehaviorEngine";
export * from "./engines/platformStatusEngine";
export * from "./engines/operationalScoreEngine";
export * from "./engines/executiveNarrativeEngine";
export * from "./engines/predictiveSignalsEngine";
export * from "./engines/menuAggregationEngine";
export * from "./engines/dataConfidenceEngine";
export * from "./engines/dataFreshnessEngine";
export * from "./engines/analyticsIntegrityEngine";
export * from "./engines/anomalyDetectionEngine";
export * from "./engines/platformHealthScoreEngine";
export * from "./engines/validationChecklistEngine";
export * from "./engines/truthValidationEngine";
export * from "./engines/conversionMetricsEngine";
export * from "./engines/reportTruthEngine";
export * from "./engines/catalogSearchEngine";
