/**
 * System-wide metric truth: never treat unknown/failed/stale as zero.
 *
 * A displayed 0 is only allowed when status is VERIFIED and value === 0.
 */

export const METRIC_STATUS = Object.freeze({
  VERIFIED: "verified",
  LOADING: "loading",
  UNAVAILABLE: "unavailable",
  PARTIAL: "partial",
  STALE: "stale",
  ERROR: "error",
  NOT_APPLICABLE: "not_applicable",
});

export function metricState({
  value = null,
  status = METRIC_STATUS.LOADING,
  source = null,
  coverageStart = null,
  coverageEnd = null,
  latestAvailableDate = null,
  missingDates = [],
  lastUpdated = null,
  error = null,
} = {}) {
  const verifiedZero = status === METRIC_STATUS.VERIFIED && value === 0;
  return {
    value,
    status,
    source,
    coverageStart,
    coverageEnd,
    latestAvailableDate,
    missingDates: Array.isArray(missingDates) ? missingDates : [],
    lastUpdated,
    error,
    verifiedZero,
  };
}

export function verifiedMetric(value, extras = {}) {
  return metricState({
    ...extras,
    value,
    status: METRIC_STATUS.VERIFIED,
  });
}

export function loadingMetric(extras = {}) {
  return metricState({ ...extras, value: null, status: METRIC_STATUS.LOADING });
}

export function unavailableMetric(reason = null, extras = {}) {
  return metricState({
    ...extras,
    value: null,
    status: METRIC_STATUS.UNAVAILABLE,
    error: reason,
  });
}

export function errorMetric(reason, extras = {}) {
  return metricState({
    ...extras,
    value: extras.value ?? null,
    status: METRIC_STATUS.ERROR,
    error: reason,
  });
}

export function partialMetric(value, extras = {}) {
  return metricState({
    ...extras,
    value,
    status: METRIC_STATUS.PARTIAL,
  });
}

/**
 * Coerce a raw number only when the fetch succeeded.
 * Failed/null/undefined sources stay unavailable — never 0.
 */
export function fromSuccessfulNumber(raw, extras = {}) {
  if (raw == null || raw === "") {
    return unavailableMetric("no_value", extras);
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return unavailableMetric("not_numeric", extras);
  return verifiedMetric(n, extras);
}

export function fromFailedSource(reason = "source_failed", extras = {}) {
  return errorMetric(reason, extras);
}

/** True only when we have evidence the value is exactly zero. */
export function isVerifiedZero(state) {
  return Boolean(state && state.status === METRIC_STATUS.VERIFIED && state.value === 0);
}

export function canDisplayNumeric(state) {
  if (!state) return false;
  return (
    (state.status === METRIC_STATUS.VERIFIED
      || state.status === METRIC_STATUS.PARTIAL
      || state.status === METRIC_STATUS.STALE)
    && state.value != null
    && Number.isFinite(Number(state.value))
  );
}

/**
 * Operator-facing text. Never show raw table/RPC names.
 */
export function formatMetricDisplay(state, { empty = "—" } = {}) {
  if (!state) return empty;
  if (state.status === METRIC_STATUS.LOADING) return "Loading";
  if (state.status === METRIC_STATUS.ERROR) return "Unavailable";
  if (state.status === METRIC_STATUS.UNAVAILABLE) return "Unavailable";
  if (state.status === METRIC_STATUS.NOT_APPLICABLE) return "Not applicable";
  if (!canDisplayNumeric(state) && state.value == null) return empty;
  return state.value;
}

export function formatMetricHint(state) {
  if (!state) return "";
  if (state.status === METRIC_STATUS.PARTIAL && state.coverageEnd) {
    return `Partial through ${state.coverageEnd}`;
  }
  if (state.status === METRIC_STATUS.STALE && state.lastUpdated) {
    return `Last updated ${state.lastUpdated}`;
  }
  if (state.status === METRIC_STATUS.ERROR || state.status === METRIC_STATUS.UNAVAILABLE) {
    if (state.error === "missing_place_id") return "Not tracked";
    if (state.error === "missing_api_key" || state.error === "fetch_failed" || state.error === "network") {
      return "Source delayed";
    }
    if (state.error === "no_snapshot") return "No recent snapshot";
    return "Unavailable";
  }
  return "";
}

/** Guard: never let UI code do `value || 0` on unresolved metrics. */
export function numericOrNull(state) {
  return canDisplayNumeric(state) ? Number(state.value) : null;
}
