/**
 * Knowledge Health Engine — calibrated weights reflecting NAC operational priorities.
 */

import { WEEKLY_DASHBOARD_FIELD_DEFS } from "../executive/manualInputParser";

/** Primary branch coverage — drives overall health score. */
export const COVERAGE_TYPE_WEIGHTS = Object.freeze({
  cash_up: 0.45,
  daily_logbook: 0.35,
  reception_daily_report: 0.10,
  daily_briefing: 0.10,
});

/** Report types required in missing-information registry (penalized if absent). */
export const REQUIRED_COVERAGE_REPORT_TYPES = Object.freeze([
  "cash_up",
  "daily_logbook",
]);

/** Optional operational types — tracked but not required for health penalties. */
export const OPTIONAL_COVERAGE_REPORT_TYPES = Object.freeze([
  "reception_daily_report",
  "daily_briefing",
]);

/** Legacy alias for tests — weighted keys. */
export const OPERATIONAL_COVERAGE_REPORT_TYPES = Object.freeze(
  Object.keys(COVERAGE_TYPE_WEIGHTS),
);

/** Core executive sources for why-analysis confidence. */
export const EXECUTIVE_CORE_WEIGHTS = Object.freeze({
  cash_up: 0.55,
  daily_logbook: 0.45,
});

/** Available when indexed — never penalize executive readiness when absent. */
export const EXECUTIVE_OPTIONAL_SOURCES = Object.freeze([
  "daily_briefing",
  "guest_feedback",
  "weekly_dashboard",
]);

/** Legacy list for compatibility. */
export const EXECUTIVE_INTELLIGENCE_REPORT_TYPES = Object.freeze([
  ...Object.keys(EXECUTIVE_CORE_WEIGHTS),
  ...EXECUTIVE_OPTIONAL_SOURCES,
]);

/** Scored weekly dashboard checklist (weights sum to 1). */
export const DASHBOARD_READINESS_CHECKS = Object.freeze([
  { key: "cash_up_week", label: "Cash-up sales for the week", weight: 0.4, source: "ask_nac_structured_facts" },
  { key: "seven_rooms_covers", label: "7Rooms covers", weight: 0.3, source: "ask_nac_manual_inputs" },
  { key: "logbook_google_reviews", label: "Google review counts (logbook)", weight: 0.2, source: "ask_nac_structured_facts" },
  { key: "logbook_commentary", label: "Daily logbook commentary", weight: 0.1, source: "ask_nac_structured_facts" },
]);

/** Informational only — not scored against dashboard readiness. */
export const DASHBOARD_HISTORY_INFO_KEY = "historical_weekly_dashboard";

export const MANUAL_INPUT_REQUIREMENTS = WEEKLY_DASHBOARD_FIELD_DEFS;

export const HEALTH_SCORE_WEIGHTS = Object.freeze({
  coverageCompleteness: 0.3,
  ingestionSuccess: 0.2,
  parserSuccess: 0.2,
  dashboardReadiness: 0.15,
  executiveIntelligenceReadiness: 0.15,
});

/** Credit when files exist in registry but period is not indexed on coverage rows. */
export const FILE_INVENTORY_PERIOD_GAP_CREDIT = 0.5;

export const REPORT_TYPE_LABELS = Object.freeze({
  cash_up: "Cash Up",
  daily_briefing: "Daily Briefing",
  daily_logbook: "Daily Logbook",
  reception_daily_report: "Reception Daily Report",
  guest_feedback: "Guest Feedback",
  weekly_dashboard: "Weekly Dashboard",
  breakage_report: "Breakage Report",
  ccm_reconciliation: "CCM Reconciliation",
});
