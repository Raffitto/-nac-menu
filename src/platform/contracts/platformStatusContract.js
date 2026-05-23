/**
 * Platform-wide data health statuses (executive-safe vocabulary).
 */

export const PLATFORM_STATUS = {
  HEALTHY: "healthy",
  PARTIAL: "partial",
  LIVE_FALLBACK: "live_fallback",
  BASELINE_BUILDING: "baseline_building",
  SPARSE_HISTORY: "sparse_history",
  STALE_ROLLUP: "stale_rollup",
  EMPTY: "empty",
};

export const PLATFORM_STATUS_LABELS = {
  [PLATFORM_STATUS.HEALTHY]: null,
  [PLATFORM_STATUS.PARTIAL]: "Partial period view",
  [PLATFORM_STATUS.LIVE_FALLBACK]: "Live activity view",
  [PLATFORM_STATUS.BASELINE_BUILDING]: "Building baseline",
  [PLATFORM_STATUS.SPARSE_HISTORY]: "Limited history",
  [PLATFORM_STATUS.STALE_ROLLUP]: "Summaries refreshing",
  [PLATFORM_STATUS.EMPTY]: "No activity yet",
};
