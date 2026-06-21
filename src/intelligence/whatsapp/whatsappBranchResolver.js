/**
 * WhatsApp branch resolution — defaults, clarification, and denial.
 */

import {
  detectBranchMention,
  resolveAllowedBranchIds,
  whatsappUserHasCrossBranchAccess,
  WHATSAPP_DENIAL_REASONS,
} from "./whatsappContract";

/**
 * @typedef {"resolved"|"needs_clarification"|"denied"} BranchResolutionStatus
 */

/**
 * @param {string} messageText
 * @param {Record<string, unknown>} whatsappUser
 * @param {{ crossBranchAllowed?: boolean }} [options]
 * @returns {{
 *   status: BranchResolutionStatus,
 *   branchId: string|null,
 *   normalizedQuestion: string,
 *   clarificationPrompt?: string,
 *   denialReason?: string,
 * }}
 */
export function resolveWhatsAppBranch(messageText = "", whatsappUser = {}, options = {}) {
  const normalizedQuestion = String(messageText).trim();
  const mentioned = detectBranchMention(normalizedQuestion);
  const allowed = resolveAllowedBranchIds(whatsappUser);
  const crossBranch = options.crossBranchAllowed ?? whatsappUserHasCrossBranchAccess(whatsappUser);

  if (mentioned) {
    if (crossBranch || allowed.includes(mentioned)) {
      return { status: "resolved", branchId: mentioned, normalizedQuestion };
    }
    return {
      status: "denied",
      branchId: null,
      normalizedQuestion,
      denialReason: WHATSAPP_DENIAL_REASONS.BRANCH_DENIED,
    };
  }

  if (allowed.length === 1) {
    return { status: "resolved", branchId: allowed[0], normalizedQuestion };
  }

  if (crossBranch && allowed.length === 0) {
    return { status: "resolved", branchId: null, normalizedQuestion };
  }

  if (allowed.length > 1) {
    return {
      status: "needs_clarification",
      branchId: null,
      normalizedQuestion,
      clarificationPrompt: `Which branch? You can access: ${allowed.join(", ")}.`,
    };
  }

  return {
    status: "denied",
    branchId: null,
    normalizedQuestion,
    denialReason: WHATSAPP_DENIAL_REASONS.BRANCH_DENIED,
  };
}

/**
 * @param {string} branchId
 * @param {Record<string, unknown>} whatsappUser
 * @returns {boolean}
 */
export function isBranchPermittedForWhatsAppUser(branchId, whatsappUser = {}) {
  if (!branchId) return whatsappUserHasCrossBranchAccess(whatsappUser);
  if (whatsappUserHasCrossBranchAccess(whatsappUser)) return true;
  return resolveAllowedBranchIds(whatsappUser).includes(branchId);
}

/**
 * @param {Record<string, unknown>} whatsappUser
 * @param {string} category
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkWhatsAppCategoryPermission(whatsappUser = {}, category = "") {
  if (!whatsappUser.is_active) {
    return { allowed: false, reason: WHATSAPP_DENIAL_REASONS.INACTIVE };
  }
  if (category === "export_request" && !whatsappUser.can_request_exports) {
    return { allowed: false, reason: WHATSAPP_DENIAL_REASONS.EXPORT_DENIED };
  }
  if (category === "alert_subscription" && !whatsappUser.can_receive_push_alerts) {
    return { allowed: false, reason: WHATSAPP_DENIAL_REASONS.ALERT_DENIED };
  }
  return { allowed: true };
}
