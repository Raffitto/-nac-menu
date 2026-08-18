/**
 * E.164 normalization for controller allowlist (no logging of raw numbers).
 */

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

/**
 * @param {string} raw
 * @returns {string|null}
 */
function normalizePhoneE164(raw = "") {
  let digits = String(raw).trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    if (digits.startsWith("966")) digits = `+${digits}`;
    else if (digits.startsWith("0")) digits = `+966${digits.slice(1)}`;
    else digits = `+${digits}`;
  }
  return E164_PATTERN.test(digits) ? digits : null;
}

/** Redact phone for logs and persisted repo artifacts. */
function redactPhoneE164(e164 = "") {
  const s = String(e164);
  if (s.length < 6) return "[redacted]";
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

module.exports = { normalizePhoneE164, redactPhoneE164, E164_PATTERN };
