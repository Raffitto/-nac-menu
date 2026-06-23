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

/** Fields commonly missing for executive / weekly dashboard estimates. */
export const EXECUTIVE_EVIDENCE_FIELD_DEFS = Object.freeze([
  ...WEEKLY_DASHBOARD_FIELD_DEFS,
  {
    key: "reservation_count",
    label: "Reservation count",
    prompt: "What was the reservation count for this period?",
    aliases: ["reservation count", "reservations", "total reservations"],
  },
  {
    key: "vip_events",
    label: "VIP events",
    prompt: "Were there any VIP or private events this period?",
    aliases: ["vip", "vip event", "private event", "vip events"],
  },
]);

export function parseManualInputAnswer(question = "", missingFields = []) {
  const text = String(question || "").trim();
  if (!text) return null;

  const fields = missingFields.length ? missingFields : WEEKLY_DASHBOARD_FIELD_DEFS;
  const lower = text.toLowerCase();

  for (const field of fields) {
    const key = field.key || field.metric_key;
    if (key === "seven_rooms_covers" || key === "reservation_count") {
      const patterns = key === "seven_rooms_covers"
        ? [
          /(\d+)\s*covers?\b/i,
          /\bcovers?\s*(?:were|was|:)?\s*(\d+)/i,
          /7\s*rooms?\s*(?:covers?)?\s*(?:were|was|:)?\s*(\d+)/i,
        ]
        : [
          /(\d+)\s*reservations?\b/i,
          /\breservations?\s*(?:were|was|:)?\s*(\d+)/i,
          /reservation count\s*(?:was|:)?\s*(\d+)/i,
        ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        const value = Number(match?.[1] || match?.[2]);
        if (Number.isFinite(value) && value >= 0) {
          return {
            metricKey: key,
            metricLabel: field.label || key,
            metricValue: value,
            rawText: text,
          };
        }
      }
    }

    if (key === "vip_events") {
      if (field.aliases?.some((a) => lower.includes(a)) || /\b(vip|private event|aramco|corporate dinner)\b/i.test(text)) {
        return {
          metricKey: key,
          metricLabel: field.label || key,
          metricValue: null,
          metricText: text,
          rawText: text,
        };
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
