/**
 * Normalize inbound WhatsApp payloads into structured control events.
 */

const { CONTROL_EVENT_TYPES, EVENT_PERMISSION_CLASS, REJECTION_REASONS } = require("./constants");
const { evaluateController } = require("./allowlist");

const APPROVE_RE = /^\s*approve(?:\s+(.+))?$/i;
const REJECT_RE = /^\s*reject(?:\s+(.+))?$/i;
const STATUS_RE = /^\s*(status|state)\s*$/i;
const CHANGE_RE = /^\s*(change|fix|implement|update)\b/i;

/**
 * @param {Record<string, unknown>} inbound
 * @param {{ allowlistE164?: string[] }} config
 */
function normalizeInboundMessage(inbound = {}, config = {}) {
  const controller = evaluateController(String(inbound.from || ""), config);
  const text = String(inbound.body || inbound.text || "").trim();
  const hasMedia = Boolean(inbound.hasMedia || inbound.mimetype || inbound.mediaType);

  if (!controller.allowed) {
    return {
      accepted: false,
      eventType: CONTROL_EVENT_TYPES.UNKNOWN,
      permissionClass: "BLOCKED",
      reason: controller.reason,
      controller,
      payload: { text: null, taskRef: null, attachment: null },
      safeForGitHub: false,
    };
  }

  if (hasMedia) {
    const attachment = {
      kind: inbound.mediaType || inbound.mimetype || "image",
      filename: inbound.filename || null,
      byteLength: inbound.byteLength || null,
      localPath: inbound.localPath || null,
      providerMessageId: inbound.id || inbound.messageId || null,
    };
    return {
      accepted: true,
      eventType: CONTROL_EVENT_TYPES.ATTACHMENT,
      permissionClass: EVENT_PERMISSION_CLASS.ATTACHMENT,
      reason: null,
      controller,
      payload: { text, taskRef: null, attachment },
      safeForGitHub: true,
    };
  }

  if (!text) {
    return {
      accepted: false,
      eventType: CONTROL_EVENT_TYPES.UNKNOWN,
      permissionClass: "BLOCKED",
      reason: REJECTION_REASONS.UNKNOWN_COMMAND,
      controller,
      payload: { text: null, taskRef: null, attachment: null },
      safeForGitHub: false,
    };
  }

  let eventType = CONTROL_EVENT_TYPES.QUESTION;
  let taskRef = null;

  const approveMatch = text.match(APPROVE_RE);
  if (approveMatch) {
    eventType = CONTROL_EVENT_TYPES.APPROVAL;
    taskRef = (approveMatch[1] || "").trim() || null;
  } else if (REJECT_RE.test(text)) {
    const rejectMatch = text.match(REJECT_RE);
    eventType = CONTROL_EVENT_TYPES.REJECTION;
    taskRef = (rejectMatch[1] || "").trim() || null;
  } else if (STATUS_RE.test(text)) {
    eventType = CONTROL_EVENT_TYPES.STATUS_REQUEST;
  } else if (CHANGE_RE.test(text)) {
    eventType = CONTROL_EVENT_TYPES.CHANGE_REQUEST;
  }

  const permissionClass = EVENT_PERMISSION_CLASS[eventType] || "BLOCKED";

  return {
    accepted: permissionClass !== "BLOCKED",
    eventType,
    permissionClass,
    reason: null,
    controller,
    payload: {
      text,
      taskRef,
      attachment: null,
    },
    safeForGitHub: permissionClass === "AUTO",
  };
}

module.exports = { normalizeInboundMessage };
