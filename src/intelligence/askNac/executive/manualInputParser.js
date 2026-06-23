/**
 * Parse short manual-input answers for pending Ask NAC sessions.
 */

export const WEEKLY_DASHBOARD_FIELD_DEFS = Object.freeze([
  {
    key: "seven_rooms_covers",
    label: "7Rooms covers",
    prompt: "What were 7Rooms covers for this week?",
    aliases: ["7rooms", "7 rooms", "covers", "reservation covers"],
  },
]);

export function parseManualInputAnswer(question = "", missingFields = []) {
  const text = String(question || "").trim();
  if (!text) return null;

  const fields = missingFields.length ? missingFields : WEEKLY_DASHBOARD_FIELD_DEFS;
  const lower = text.toLowerCase();

  for (const field of fields) {
    const key = field.key || field.metric_key;
    if (key === "seven_rooms_covers") {
      const patterns = [
        /(\d+)\s*covers?\b/i,
        /\bcovers?\s*(?:were|was|:)?\s*(\d+)/i,
        /7\s*rooms?\s*(?:covers?)?\s*(?:were|was|:)?\s*(\d+)/i,
      ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        const value = Number(match?.[1] || match?.[2]);
        if (Number.isFinite(value) && value >= 0) {
          return {
            metricKey: "seven_rooms_covers",
            metricLabel: "7Rooms covers",
            metricValue: value,
            rawText: text,
          };
        }
      }
    }

    if (field.aliases?.some((a) => lower.includes(a))) {
      const numMatch = text.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        return {
          metricKey: key,
          metricLabel: field.label || key,
          metricValue: Number(numMatch[1]),
          rawText: text,
        };
      }
    }
  }

  if (/^\d+(?:\.\d+)?$/.test(text) && fields.length === 1) {
    const field = fields[0];
    return {
      metricKey: field.key || field.metric_key,
      metricLabel: field.label || field.key,
      metricValue: Number(text),
      rawText: text,
    };
  }

  return null;
}

export function isLikelyManualInputAnswer(question = "", { pendingSessionId, awaitingInput } = {}) {
  if (!pendingSessionId && !awaitingInput) return false;
  const text = String(question || "").trim();
  if (isTeachLike(text)) return false;
  if (/\bgenerate\b.*\bdashboard\b/i.test(text)) return false;
  return parseManualInputAnswer(text) != null || /^\d+(?:\.\d+)?$/.test(text);
}

function isTeachLike(text) {
  return /^(teach nac|remember this|save as operator knowledge):/i.test(text);
}
