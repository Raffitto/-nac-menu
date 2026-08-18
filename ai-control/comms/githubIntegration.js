/**
 * GitHub control-plane integration — builds NON-PRODUCTION artifacts only.
 * WhatsApp never bypasses PERMISSIONS.md; ASK_RAFFI events are recorded, not executed.
 */

const fs = require("fs");
const path = require("path");

const PERMISSIONS_PATH = "ai-control/PERMISSIONS.md";

/**
 * @param {ReturnType<typeof import("./normalizer").normalizeInboundMessage>} normalized
 * @param {{ controlRoomIssue?: number, repoRoot?: string }} ctx
 */
function buildGitHubControlArtifact(normalized, ctx = {}) {
  const issue = ctx.controlRoomIssue || 2;
  const repoRoot = ctx.repoRoot || process.cwd();

  let permissionsSnippet = "";
  try {
    const permPath = path.join(repoRoot, PERMISSIONS_PATH);
    permissionsSnippet = fs.readFileSync(permPath, "utf8").split("\n").slice(0, 8).join("\n");
  } catch {
    permissionsSnippet = "PERMISSIONS.md unavailable";
  }

  if (!normalized.controller?.allowed) {
    return {
      action: "ignore",
      issueNumber: issue,
      commentBody: null,
      artifactPath: null,
      permissionGate: "BLOCKED",
      reason: normalized.reason,
    };
  }

  if (normalized.permissionClass === "ASK_RAFFI") {
    return {
      action: "record_pending_decision",
      issueNumber: issue,
      commentBody: [
        "WhatsApp control event (pending human decision — not auto-executed)",
        `Event: ${normalized.eventType}`,
        `Controller: ${normalized.controller.senderRedacted}`,
        `Permission: ASK_RAFFI per ${PERMISSIONS_PATH}`,
        normalized.payload.taskRef ? `Task ref: ${normalized.payload.taskRef}` : null,
        normalized.payload.text ? `Text: ${normalized.payload.text.slice(0, 500)}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      artifactPath: "ai-control/comms/pending-decisions.jsonl",
      permissionGate: "ASK_RAFFI",
      reason: null,
    };
  }

  if (!normalized.safeForGitHub) {
    return {
      action: "ignore",
      issueNumber: issue,
      commentBody: null,
      artifactPath: null,
      permissionGate: "BLOCKED",
      reason: normalized.reason || "not_safe_for_github",
    };
  }

  const artifact = {
    source: "whatsapp-control-bridge",
    eventType: normalized.eventType,
    permissionClass: normalized.permissionClass,
    controllerRedacted: normalized.controller.senderRedacted,
    receivedAt: new Date().toISOString(),
    payload: {
      text: normalized.payload.text,
      attachment: normalized.payload.attachment
        ? {
            kind: normalized.payload.attachment.kind,
            filename: normalized.payload.attachment.filename,
            byteLength: normalized.payload.attachment.byteLength,
          }
        : null,
    },
    permissionsReference: permissionsSnippet,
    containsSessionMaterial: false,
  };

  return {
    action: "upsert_control_artifact",
    issueNumber: issue,
    commentBody: [
      "WhatsApp control event recorded (AUTO — no production change)",
      `Event: ${normalized.eventType}`,
      `Controller: ${normalized.controller.senderRedacted}`,
      normalized.payload.text ? `Summary: ${normalized.payload.text.slice(0, 280)}` : "Attachment metadata only",
    ].join("\n"),
    artifactPath: "ai-control/comms/inbound-events.jsonl",
    artifact,
    permissionGate: "AUTO",
    reason: null,
  };
}

module.exports = { buildGitHubControlArtifact, PERMISSIONS_PATH };
