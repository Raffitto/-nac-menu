/** Feature flag: single Operational Dashboard (replaces Operations + Session Analytics tabs). */
export function isUnifiedOverviewEnabled() {
  return process.env.REACT_APP_UNIFIED_OVERVIEW === "1";
}
