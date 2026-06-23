/**
 * Knowledge Health Engine — expected sources derived from vault registry metadata.
 */

import { WEEKLY_DASHBOARD_FIELD_DEFS } from "../executive/manualInputParser";

/** Core operational reports expected for day-to-day coverage scoring. */
export const OPERATIONAL_COVERAGE_REPORT_TYPES = Object.freeze([
  "cash_up",
  "daily_briefing",
  "daily_logbook",
  "reception_daily_report",
]);

/** Sources that reduce executive / why-analysis confidence when missing. */
export const EXECUTIVE_INTELLIGENCE_REPORT_TYPES = Object.freeze([
  "cash_up",
  "daily_briefing",
  "daily_logbook",
  "guest_feedback",
  "weekly_dashboard",
]);

/** Weekly dashboard readiness checklist (weights must sum to 1). */
export const DASHBOARD_READINESS_CHECKS = Object.freeze([
  { key: "cash_up_week", label: "Cash-up sales for the week", weight: 0.35, source: "ask_nac_structured_facts" },
  { key: "seven_rooms_covers", label: "7Rooms covers", weight: 0.25, source: "ask_nac_manual_inputs" },
  { key: "logbook_google_reviews", label: "Google review counts (logbook)", weight: 0.2, source: "ask_nac_structured_facts" },
  { key: "logbook_commentary", label: "Daily logbook commentary", weight: 0.1, source: "ask_nac_structured_facts" },
  { key: "historical_weekly_dashboard", label: "Historical weekly dashboard", weight: 0.1, source: "ask_nac_data_coverage" },
]);

export const MANUAL_INPUT_REQUIREMENTS = WEEKLY_DASHBOARD_FIELD_DEFS;

export const HEALTH_SCORE_WEIGHTS = Object.freeze({
  coverageCompleteness: 0.3,
  ingestionSuccess: 0.2,
  parserSuccess: 0.2,
  dashboardReadiness: 0.15,
  executiveIntelligenceReadiness: 0.15,
});

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
