/**
 * Ask NAC routing for NIL "why" business questions (internal cash-up analytics only).
 */

import {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
  parseExplicitDateRangeFromText,
} from "./vaultPeriodParser.ts";

const WHY_QUESTION_SIGNAL =
  /\b(?:why|what caused|what caused the|reason for|explain(?: the)?(?: drop| decline| decrease| fall| change| lower| weaker)?|why(?: was| were| is| did)|why lower|why down|why weaker)\b/;

const WHY_METRIC_SIGNAL =
  /\b(sales|revenue|guests?|guest count|delivery|average spend|avg spend|spend per guest|orders?)\b/;

const WHY_DECLINE_SIGNAL =
  /\b(down|lower|decline|declined|decrease|decreased|drop|dropped|weaker|fall|fell|soft|softened)\b/;

export function isWhyBusinessQuestion(question = "") {
  const q = String(question || "").toLowerCase().trim();
  return WHY_QUESTION_SIGNAL.test(q) && WHY_METRIC_SIGNAL.test(q);
}

export function detectWhyMetricFocus(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(average spend|avg spend|spend per guest)\b/.test(q)) return "avg_spend";
  if (/\b(guests?|guest count)\b/.test(q)) return "guests";
  if (/\b(delivery)\b/.test(q)) return "delivery";
  if (/\b(orders?)\b/.test(q)) return "orders";
  if (/\b(sales|revenue)\b/.test(q)) return "sales";
  return "general";
}

export function scoreVaultBusinessReasoningIntent(question = "") {
  const q = String(question || "").toLowerCase().trim();
  if (!isWhyBusinessQuestion(q)) return 0;
  if (/\b(logbook|document search|uploaded documents?)\b/.test(q) && !/\bcash[\s-]?up\b/.test(q)) return 0;

  let score = 38;
  if (WHY_DECLINE_SIGNAL.test(q)) score += 4;
  if (parseVaultComparePeriodsFromQuestion(question)) score += 3;
  if (parseVaultPeriodFromQuestion(question)) score += 2;
  if (/\b(last|past)\s+\d+\s+days?\b/.test(q)) score += 2;
  if (parseExplicitDateRangeFromText(q)) score += 2;
  return score;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoDate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function shiftLocalDate(referenceDate, dayDelta) {
  const day = new Date(referenceDate);
  day.setDate(day.getDate() + dayDelta);
  return day;
}

function formatRangeLabel(startDate, endDate) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  if (startDate === endDate) {
    return new Date(Date.UTC(sy, sm - 1, sd, 12)).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (sy === ey && sm === em) {
    const monthLabel = new Date(Date.UTC(sy, sm - 1, 1, 12)).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return `${sd}–${ed} ${monthLabel}`;
  }
  return `${startDate} – ${endDate}`;
}

function rollingRange(referenceDate, days, { endOffset = 0, label, periodType }) {
  const end = shiftLocalDate(referenceDate, endOffset);
  const start = shiftLocalDate(end, -(days - 1));
  return {
    startDate: isoDate(start.getFullYear(), start.getMonth() + 1, start.getDate()),
    endDate: isoDate(end.getFullYear(), end.getMonth() + 1, end.getDate()),
    label,
    periodType,
    isSingleDay: false,
    isRange: true,
  };
}

function previousEqualWindowPeriod(period) {
  const start = new Date(`${period.startDate}T12:00:00`);
  const end = new Date(`${period.endDate}T12:00:00`);
  const dayCount = Math.round((end - start) / 86400000) + 1;
  const prevEnd = shiftLocalDate(start, -1);
  const prevStart = shiftLocalDate(prevEnd, -(dayCount - 1));
  return {
    startDate: isoDate(prevStart.getFullYear(), prevStart.getMonth() + 1, prevStart.getDate()),
    endDate: isoDate(prevEnd.getFullYear(), prevEnd.getMonth() + 1, prevEnd.getDate()),
    label: dayCount === 1
      ? `previous day (${isoDate(prevEnd.getFullYear(), prevEnd.getMonth() + 1, prevEnd.getDate())})`
      : `previous ${dayCount} days`,
    periodType: "previous_window",
    isSingleDay: dayCount === 1,
    isRange: dayCount > 1,
  };
}

function stripWhyLead(question = "") {
  return String(question || "")
    .replace(/^\s*(?:why|what caused|what caused the|reason for|explain(?: the)?)\s+/i, "")
    .replace(/^\s*(?:were|was|is|are|did)\s+/i, "")
    .trim();
}

function resolveCompareFromVsPattern(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase().trim();
  const vsMatch = q.match(/(.+?)\s+(?:vs|versus|against|compared to|with|lower than|higher than)\s+(.+)$/);
  if (!vsMatch) return null;
  return parseVaultComparePeriodsFromQuestion(`compare ${vsMatch[1]} vs ${vsMatch[2]}`, referenceDate);
}

/**
 * Resolve current + comparison periods for why questions.
 * @param {string} question
 * @param {Date} [referenceDate]
 */
export function resolveWhyVaultCompare(question = "", referenceDate = new Date()) {
  const explicit = parseVaultComparePeriodsFromQuestion(question, referenceDate);
  if (explicit?.current && explicit?.previous) {
    return { ...explicit, periodType: explicit.periodType || "why_compare", isComparison: true };
  }

  const vsCompare = resolveCompareFromVsPattern(question, referenceDate);
  if (vsCompare?.current && vsCompare?.previous) {
    return { ...vsCompare, periodType: "why_compare", isComparison: true };
  }

  const stripped = stripWhyLead(question);
  const period = parseVaultPeriodFromQuestion(stripped, referenceDate)
    || parseVaultPeriodFromQuestion(question, referenceDate);
  if (!period?.startDate) return null;

  if (period.periodType === "last_7_days") {
    const previousEnd = shiftLocalDate(new Date(`${period.startDate}T12:00:00`), -1);
    const previous = rollingRange(previousEnd, 7, {
      label: "previous 7 days",
      periodType: "previous_7_days",
    });
    return { current: period, previous, periodType: "why_compare", isComparison: true };
  }

  if (period.periodType === "last_14_days") {
    const previousEnd = shiftLocalDate(new Date(`${period.startDate}T12:00:00`), -1);
    const previous = rollingRange(previousEnd, 14, {
      label: "previous 14 days",
      periodType: "previous_14_days",
    });
    return { current: period, previous, periodType: "why_compare", isComparison: true };
  }

  const previous = previousEqualWindowPeriod(period);
  return {
    current: {
      ...period,
      label: period.label || formatRangeLabel(period.startDate, period.endDate),
    },
    previous: {
      ...previous,
      label: previous.label || formatRangeLabel(previous.startDate, previous.endDate),
    },
    periodType: "why_compare",
    isComparison: true,
  };
}
