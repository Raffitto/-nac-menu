/**
 * NAC OS — shared intelligence platform layer.
 * Import from here in new code; legacy paths re-export for compatibility.
 */

export * from "./contracts/intelligenceRangeContract";
export * from "./contracts/platformStatusContract";

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
