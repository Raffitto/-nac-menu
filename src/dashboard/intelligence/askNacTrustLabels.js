import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";

/** User-facing trust label for mobile answer cards (UI only). */
export function getMobileTrustSummary(response) {
  if (!response) {
    return { label: "Verified Data", tone: "verified" };
  }

  if (response.answerType === ANSWER_TYPES.ERROR) {
    return { label: "Data Unavailable", tone: "error" };
  }

  if (response.answerType === ANSWER_TYPES.MISSING_DATA) {
    return { label: "Partial Data", tone: "partial" };
  }

  if (response.isAiGenerated) {
    return { label: "AI Explained", tone: "ai" };
  }

  if (response.localFallback) {
    return { label: "Partial Data", tone: "partial" };
  }

  return { label: "Verified Data", tone: "verified" };
}

/** Technical metadata shown inside collapsed Details (audit trail preserved). */
export function getTechnicalTrustDetails(response) {
  if (!response) return [];

  const rows = [];

  if (response.conversationResolution?.usedContext && response.conversationResolution?.resolvedQuestion) {
    rows.push({
      label: "Resolved as",
      value: `"${response.conversationResolution.resolvedQuestion}"`,
    });
  }

  if (response.isAiGenerated) {
    rows.push({ label: "Narration", value: "AI explained (server)" });
  } else if (response.serverConnected && !response.localFallback) {
    rows.push({ label: "Computation", value: "Verified deterministic" });
  } else {
    rows.push({ label: "Computation", value: "Verified data" });
  }

  if (response.localFallback) {
    rows.push({ label: "Fallback", value: "Local fallback" });
  }

  if (response.serverConnected != null) {
    rows.push({
      label: "Server",
      value: response.serverConnected ? "Server connected" : "Server unavailable",
    });
  }

  if (response.aiConnected != null) {
    rows.push({
      label: "AI pipeline",
      value: response.aiConnected ? "AI connected" : "AI unavailable",
    });
  }

  if (response.confidence) {
    rows.push({ label: "Confidence", value: `${response.confidence} confidence` });
  }

  return rows;
}

/** Header badge for mobile Ask NAC top bar. */
export function getMobileConnectionBadge({
  lastResponse = null,
  session = null,
  serverConfigured = false,
}) {
  if (lastResponse) {
    const summary = getMobileTrustSummary(lastResponse);
    return {
      label: summary.label,
      shortLabel: summary.label,
      tone: summary.tone === "verified" ? "connected" : summary.tone === "ai" ? "ai" : summary.tone === "partial" ? "local" : "local",
    };
  }

  if (serverConfigured && session?.access_token) {
    return { label: "AI Connected", shortLabel: "AI Connected", tone: "connected" };
  }

  if (serverConfigured) {
    return { label: "Partial Data", shortLabel: "Partial Data", tone: "local" };
  }

  return { label: "Partial Data", shortLabel: "Partial Data", tone: "local" };
}
