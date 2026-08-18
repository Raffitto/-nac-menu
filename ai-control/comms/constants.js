/**
 * NAC engineering WhatsApp control bridge — event types and permission classes.
 * Transport-only; does not connect to WhatsApp. See ai-control/PERMISSIONS.md.
 */

/** @enum {string} */
const CONTROL_EVENT_TYPES = Object.freeze({
  QUESTION: "QUESTION",
  STATUS_REQUEST: "STATUS_REQUEST",
  CHANGE_REQUEST: "CHANGE_REQUEST",
  APPROVAL: "APPROVAL",
  REJECTION: "REJECTION",
  ATTACHMENT: "ATTACHMENT",
  UNKNOWN: "UNKNOWN",
});

/** Maps inbound events to permission classes from PERMISSIONS.md */
const EVENT_PERMISSION_CLASS = Object.freeze({
  QUESTION: "AUTO",
  STATUS_REQUEST: "AUTO",
  CHANGE_REQUEST: "ASK_RAFFI",
  APPROVAL: "ASK_RAFFI",
  REJECTION: "ASK_RAFFI",
  ATTACHMENT: "AUTO",
  UNKNOWN: "BLOCKED",
});

const REJECTION_REASONS = Object.freeze({
  NOT_ALLOWLISTED: "not_allowlisted",
  UNKNOWN_COMMAND: "unknown_command",
  PERMISSION_BLOCKED: "permission_blocked",
  INVALID_PHONE: "invalid_phone",
});

module.exports = {
  CONTROL_EVENT_TYPES,
  EVENT_PERMISSION_CLASS,
  REJECTION_REASONS,
};
