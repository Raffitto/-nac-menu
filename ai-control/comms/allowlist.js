/**
 * Controller allowlist — only authorized numbers may trigger GitHub control actions.
 */

const { normalizePhoneE164, redactPhoneE164 } = require("./phone");
const { REJECTION_REASONS } = require("./constants");

/**
 * @param {string[]} allowlistE164
 * @returns {{ allowlistE164: string[], allowlistHash: string }}
 */
function buildAllowlistConfig(allowlistE164 = []) {
  const normalized = allowlistE164
    .map((n) => normalizePhoneE164(n))
    .filter(Boolean);
  const unique = [...new Set(normalized)];
  const allowlistHash = `sha256-placeholder-${unique.length}`;
  return { allowlistE164: unique, allowlistHash };
}

/**
 * @param {string} senderRaw
 * @param {{ allowlistE164?: string[] }} config
 */
function evaluateController(senderRaw, config = {}) {
  const sender = normalizePhoneE164(senderRaw);
  if (!sender) {
    return {
      allowed: false,
      senderE164: null,
      senderRedacted: "[invalid]",
      reason: REJECTION_REASONS.INVALID_PHONE,
    };
  }

  const list = config.allowlistE164 || [];
  if (!list.includes(sender)) {
    return {
      allowed: false,
      senderE164: sender,
      senderRedacted: redactPhoneE164(sender),
      reason: REJECTION_REASONS.NOT_ALLOWLISTED,
    };
  }

  return {
    allowed: true,
    senderE164: sender,
    senderRedacted: redactPhoneE164(sender),
    reason: null,
  };
}

module.exports = { buildAllowlistConfig, evaluateController };
