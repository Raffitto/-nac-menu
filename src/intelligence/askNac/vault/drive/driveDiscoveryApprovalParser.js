/**
 * Parse natural-language Drive discovery approval commands.
 */
import { DISCOVERY_REPORT_TYPES } from "./driveDiscoveryClassifier";

const INGEST_VERBS = /\b(ingest|include|approve|enable|sync|import|add)\b/i;
const IGNORE_VERBS = /\b(ignore|exclude|skip|never ingest|do not ingest|don't ingest|dont ingest)\b/i;
const ASK_VERBS = /\b(ask me about|ask about|defer|later|hold)\b/i;
const TREAT_AS = /\b(treat|classify|map|use|as)\b/i;

const FOLDER_ALIASES = [
  { pattern: /\bcash[\s-]?up\b|\bcashup\b/i, label: "Cash Up", type: "cash_up" },
  { pattern: /\blog\s?book\b/i, label: "Logbook", type: "daily_logbook" },
  { pattern: /\bdaily reception\b|\breception\b/i, label: "Daily Reception", type: "daily_reception" },
  { pattern: /\bdaily briefing\b|\bbriefing\b/i, label: "Daily Briefing", type: "daily_briefing" },
  { pattern: /\bccm\b|\bfoodics\b/i, label: "CCM and Foodics", type: "ccm_reconciliation" },
  { pattern: /\bbreakage\b/i, label: "Breakage", type: "breakage_report" },
  { pattern: /\bdiscount and comp\b|\bdiscounts?\b|\bvoids?\b|\bcomp\b/i, label: "Discount and comp", type: "discount_void_comp" },
  { pattern: /\bguest feedback\b/i, label: "Guest Feedback", type: "guest_feedback" },
  { pattern: /\bweekly dashboards?\b/i, label: "Weekly Dashboards", type: "weekly_dashboard" },
  { pattern: /\bdaily napkins count\b|\bnapkins count\b/i, label: "Daily Napkins Count", type: "ignore" },
  { pattern: /\bmonthly cash safe\b/i, label: "Monthly Cash Safe", type: "ignore" },
];

export function isDriveDiscoveryApprovalCommand(question = "") {
  const text = String(question || "").trim();
  if (/^approve drive ingestion rules\b/i.test(text)) return true;
  if (INGEST_VERBS.test(text) && FOLDER_ALIASES.some(({ pattern }) => pattern.test(text))) return true;
  if (IGNORE_VERBS.test(text) && FOLDER_ALIASES.some(({ pattern }) => pattern.test(text))) return true;
  if (ASK_VERBS.test(text) && FOLDER_ALIASES.some(({ pattern }) => pattern.test(text))) return true;
  if (TREAT_AS.test(text) && FOLDER_ALIASES.some(({ pattern }) => pattern.test(text))) return true;
  return false;
}

export function isDriveDiscoveryCommand(question = "") {
  return /\bdiscover drive folders?\b/i.test(String(question || "").trim());
}

function resolveAction(text = "") {
  if (IGNORE_VERBS.test(text) || /\bnever ingest\b/i.test(text)) return "ignore";
  if (ASK_VERBS.test(text)) return "ask";
  if (INGEST_VERBS.test(text)) return "ingest";
  if (TREAT_AS.test(text)) return "ingest";
  return "ingest";
}

function resolveExplicitType(text = "") {
  for (const type of DISCOVERY_REPORT_TYPES) {
    if (type === "unknown_needs_review") continue;
    const re = new RegExp(`\\b${type.replace(/_/g, "[\\s_]?")}\\b`, "i");
    if (re.test(text)) return type;
  }
  return null;
}

export function parseDriveDiscoveryApprovalCommand(question = "", { createdBy = "admin" } = {}) {
  const text = String(question || "").trim();
  const action = resolveAction(text);
  const explicitType = resolveExplicitType(text);
  const decisions = [];

  for (const alias of FOLDER_ALIASES) {
    if (!alias.pattern.test(text)) continue;
    const detectedType = explicitType || alias.type;
    decisions.push({
      folderPathPattern: alias.label,
      detectedReportType: detectedType,
      action: detectedType === "ignore" ? "ignore" : action,
      confidence: 0.95,
      reason: `Approved via Ask NAC: "${text.slice(0, 180)}"`,
      createdBy,
    });
  }

  return {
    raw: text,
    decisions,
    action,
  };
}
