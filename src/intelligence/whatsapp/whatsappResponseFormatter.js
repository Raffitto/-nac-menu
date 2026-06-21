/**
 * Format Ask NAC deterministic answers for WhatsApp (mobile-friendly text).
 */

import { WHATSAPP_RESPONSE_TYPES } from "./whatsappContract";

const MAX_DIRECT_ANSWER_CHARS = 3500;
const EXTERNAL_CONTEXT_MARKER = "No external context sources are connected yet";

/**
 * @param {Record<string, unknown>} answer
 * @param {{ developerMode?: boolean, branchLabel?: string }} [options]
 * @returns {{ text: string, responseType: string }}
 */
export function formatAskNacAnswerForWhatsApp(answer = {}, options = {}) {
  if (!answer || typeof answer !== "object") {
    return { text: "No answer was produced.", responseType: WHATSAPP_RESPONSE_TYPES.ERROR };
  }

  const branchLabel = options.branchLabel || answer.branchLabel || "Branch";
  const title = answer.title ? String(answer.title) : "NAC OS";
  const intent = String(answer.intent || "");

  if (intent === "vault_business_reasoning" || String(answer.directAnswer || "").includes("Confirmed Facts")) {
    return {
      text: formatNilWhyAnswer(answer, branchLabel, title),
      responseType: WHATSAPP_RESPONSE_TYPES.NIL_WHY,
    };
  }

  if (intent === "vault_cash_up_summary" || Array.isArray(answer.keyMetrics)) {
    return {
      text: formatCashUpAnswer(answer, branchLabel, title),
      responseType: WHATSAPP_RESPONSE_TYPES.CASH_UP,
    };
  }

  const direct = stripInternalFields(String(answer.directAnswer || answer.summary || ""), options.developerMode);
  const header = `NAC OS — ${branchLabel}\n${title}`;
  return {
    text: truncate(`${header}\n\n${direct || "No details available."}`),
    responseType: WHATSAPP_RESPONSE_TYPES.CASH_UP,
  };
}

function formatNilWhyAnswer(answer, branchLabel, title) {
  let body = String(answer.directAnswer || "");
  body = body.replace(/\n{3,}/g, "\n\n");
  body = body.replace(/^\* /gm, "• ");
  if (!body.includes(EXTERNAL_CONTEXT_MARKER)) {
    body += `\n\nExternal Context\n• ${EXTERNAL_CONTEXT_MARKER}.`;
  }
  return truncate(`NAC OS — ${branchLabel}\n${title}\n\n${body}`);
}

function formatCashUpAnswer(answer, branchLabel, title) {
  const metrics = (answer.keyMetrics || []).slice(0, 12);
  const lines = metrics.map((m) => {
    const label = m?.label || "Metric";
    const value = m?.value != null ? m.value : "—";
    const unit = m?.unit ? ` ${m.unit}` : "";
    return `${label}: ${value}${unit}`;
  });

  const header = `NAC OS — ${branchLabel}\n${title}`;
  const block = lines.length ? lines.join("\n") : String(answer.directAnswer || "").slice(0, 800);
  const source = answer.periodLabel ? `\n\nSource: Uploaded cash-up · ${answer.periodLabel}` : "";
  return truncate(`${header}\n\n${block}${source}`);
}

function stripInternalFields(text, developerMode = false) {
  if (developerMode) return text;
  return text
    .replace(/cashUpProductionTrace[\s\S]*?(?=\n\n|$)/gi, "")
    .replace(/routingDebug[\s\S]*?(?=\n\n|$)/gi, "")
    .trim();
}

function truncate(text) {
  if (text.length <= MAX_DIRECT_ANSWER_CHARS) return text;
  return `${text.slice(0, MAX_DIRECT_ANSWER_CHARS - 20)}\n\n(reply MORE — future)`;
}

/**
 * @param {string} reason
 * @returns {string}
 */
export function formatWhatsAppDenial(reason = "") {
  const messages = {
    not_allowlisted: "This number is not authorized for NAC OS WhatsApp. Contact your administrator.",
    inactive_user: "Your WhatsApp access is inactive. Contact your administrator.",
    branch_not_permitted: "You don't have access to that branch.",
    export_not_permitted: "Export requests are not enabled for your account.",
    alerts_not_permitted: "Alert subscriptions are not enabled for your account.",
    rate_limited: "Too many messages. Please wait a moment and try again.",
    invalid_phone: "Could not verify your phone number.",
  };
  return messages[reason] || "Request could not be completed.";
}
