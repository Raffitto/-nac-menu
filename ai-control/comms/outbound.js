/**
 * Outbound WhatsApp payloads for engineering control (send-equivalent formatting).
 */

/**
 * @param {Record<string, unknown>} handoff
 */
function formatDailyHandoffSummary(handoff = {}) {
  const taskId = handoff.taskId || "unknown";
  const result = handoff.result || "PENDING";
  const branch = handoff.branch || "release/ask-nac-fabric-founding-day";
  const tests = handoff.tests || "n/a";
  const next = handoff.nextStep || "awaiting_review";

  const lines = [
    "NAC Engineering — daily handoff",
    `Task: ${taskId}`,
    `Result: ${result}`,
    `Branch: ${branch}`,
    `Tests: ${tests}`,
    `Next: ${next}`,
  ];

  if (handoff.blocker) {
    lines.push(`Blocker: ${String(handoff.blocker).slice(0, 200)}`);
  }

  return {
    channel: "whatsapp",
    messageType: "daily_handoff_summary",
    text: lines.join("\n"),
    metadata: {
      taskId,
      result,
      containsSecrets: false,
    },
  };
}

/**
 * @param {Record<string, unknown>} decision
 */
function formatBlockerDecisionRequest(decision = {}) {
  const title = decision.title || "Decision required";
  const options = Array.isArray(decision.options) ? decision.options : [];
  const context = decision.context || "";

  const lines = [
    "NAC Engineering — decision needed",
    title,
  ];
  if (context) lines.push(context);
  if (options.length) {
    lines.push("Options:");
    options.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
  }
  lines.push("Reply: approve <task> | reject <task> | status");

  return {
    channel: "whatsapp",
    messageType: "blocker_decision_request",
    text: lines.join("\n"),
    metadata: {
      decisionId: decision.decisionId || null,
      containsSecrets: false,
    },
  };
}

module.exports = { formatDailyHandoffSummary, formatBlockerDecisionRequest };
