/**
 * WhatsApp → Ask NAC foundation contracts.
 * Transport-layer constants and normalization — no live provider integration.
 */

/** @enum {string} */
export const WHATSAPP_MESSAGE_CATEGORIES = Object.freeze({
  ASK_NAC_FREE_TEXT: "ask_nac_free_text",
  BRANCH_QUESTION: "branch_question",
  REPORT_REQUEST: "report_request",
  EXPORT_REQUEST: "export_request",
  DAILY_BRIEF: "daily_brief",
  ALERT_SUBSCRIPTION: "alert_subscription",
  HELP: "help",
  UNKNOWN: "unknown",
});

/** Maps WhatsApp personas to existing ask_nac_roles codes (reuse, do not fork). */
export const WHATSAPP_VAULT_ROLE_DEFAULTS = Object.freeze({
  EXECUTIVE: "ceo",
  DEVELOPER: "super_admin",
  GM: "branch_manager",
  ASSISTANT_MANAGER: "ops_manager",
  RECEPTION: "reception_manager",
  STAFF: "staff",
});

export const WHATSAPP_RESPONSE_TYPES = Object.freeze({
  NIL_WHY: "nil_why",
  CASH_UP: "cash_up",
  DELIVERY_MIX: "delivery_mix",
  COMPARE: "compare",
  HELP: "help",
  CLARIFICATION: "clarification",
  DENIED: "denied",
  ERROR: "error",
});

export const WHATSAPP_DENIAL_REASONS = Object.freeze({
  NOT_ALLOWLISTED: "not_allowlisted",
  INACTIVE: "inactive_user",
  BRANCH_DENIED: "branch_not_permitted",
  EXPORT_DENIED: "export_not_permitted",
  ALERT_DENIED: "alerts_not_permitted",
  RATE_LIMITED: "rate_limited",
  INVALID_PHONE: "invalid_phone",
});

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

const BRANCH_ALIASES = {
  khobar: ["khobar", "al khobar", "alkhobar"],
  riyadh: ["riyadh", "riyad"],
  jeddah: ["jeddah", "jedda"],
};

const HELP_KEYWORDS = /^(help|\?|commands|what can you do)\s*$/i;
const EXPORT_KEYWORDS = /\b(pdf|export|send report|weekly report|csv)\b/i;
const ALERT_KEYWORDS = /\b(subscribe|alert|notify|notification)\b/i;
const BRIEF_KEYWORDS = /\b(daily brief|morning brief|today brief)\b/i;
const REPORT_KEYWORDS = /\b(send report|weekly report|monthly report)\b/i;

/**
 * Normalize a phone number to E.164.
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizePhoneE164(raw = "") {
  let digits = String(raw).trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    if (digits.startsWith("966")) digits = `+${digits}`;
    else if (digits.startsWith("0")) digits = `+966${digits.slice(1)}`;
    else digits = `+${digits}`;
  }
  return E164_PATTERN.test(digits) ? digits : null;
}

/**
 * @param {string} text
 * @returns {{ category: string, normalizedText: string }}
 */
export function classifyWhatsAppMessage(text = "") {
  const normalizedText = String(text).trim().replace(/\s+/g, " ");
  const lower = normalizedText.toLowerCase();

  if (!normalizedText) {
    return { category: WHATSAPP_MESSAGE_CATEGORIES.UNKNOWN, normalizedText: "" };
  }
  if (HELP_KEYWORDS.test(lower)) {
    return { category: WHATSAPP_MESSAGE_CATEGORIES.HELP, normalizedText: normalizedText };
  }
  if (ALERT_KEYWORDS.test(lower)) {
    return { category: WHATSAPP_MESSAGE_CATEGORIES.ALERT_SUBSCRIPTION, normalizedText: normalizedText };
  }
  if (BRIEF_KEYWORDS.test(lower)) {
    return { category: WHATSAPP_MESSAGE_CATEGORIES.DAILY_BRIEF, normalizedText: normalizedText };
  }
  if (EXPORT_KEYWORDS.test(lower) || REPORT_KEYWORDS.test(lower)) {
    const category = EXPORT_KEYWORDS.test(lower)
      ? WHATSAPP_MESSAGE_CATEGORIES.EXPORT_REQUEST
      : WHATSAPP_MESSAGE_CATEGORIES.REPORT_REQUEST;
    return { category, normalizedText: normalizedText };
  }
  if (detectBranchMention(lower)) {
    return { category: WHATSAPP_MESSAGE_CATEGORIES.BRANCH_QUESTION, normalizedText: normalizedText };
  }
  return { category: WHATSAPP_MESSAGE_CATEGORIES.ASK_NAC_FREE_TEXT, normalizedText: normalizedText };
}

/**
 * @param {string} text
 * @returns {string|null}
 */
export function detectBranchMention(text = "") {
  const lower = String(text).toLowerCase();
  for (const [branchId, aliases] of Object.entries(BRANCH_ALIASES)) {
    if (aliases.some((alias) => lower.includes(alias))) return branchId;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} whatsappUser
 * @returns {string[]}
 */
export function resolveAllowedBranchIds(whatsappUser = {}) {
  const explicit = Array.isArray(whatsappUser.allowed_branch_ids)
    ? whatsappUser.allowed_branch_ids.filter(Boolean)
    : [];
  if (explicit.length) return explicit;
  if (whatsappUser.primary_branch_id) return [String(whatsappUser.primary_branch_id)];
  return [];
}

/**
 * @param {Record<string, unknown>} whatsappUser
 * @returns {boolean}
 */
export function whatsappUserHasCrossBranchAccess(whatsappUser = {}) {
  const role = String(whatsappUser.vault_role || "");
  return ["ceo", "super_admin", "marketing"].includes(role);
}

/**
 * Static help text for WhatsApp (concise).
 */
export function buildWhatsAppHelpText() {
  return [
    "NAC OS on WhatsApp",
    "",
    "Ask anything:",
    "• show latest cash up",
    "• sales from June 1 to June 15",
    "• compare June 1-15 vs May 1-15",
    "• why were sales down last 7 days",
    "• delivery mix this month",
    "",
    "Include your branch (Khobar, Riyadh, Jeddah) if you have access to multiple.",
    "Reply help anytime.",
  ].join("\n");
}
