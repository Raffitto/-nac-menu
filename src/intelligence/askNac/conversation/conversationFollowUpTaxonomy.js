/**
 * Formal follow-up taxonomy for Conversation Intelligence V1.
 */

export const FOLLOW_UP_CATEGORIES = Object.freeze({
  VISUALIZATION: "visualization",
  DRILL_DOWN: "drill_down",
  COMPARISON: "comparison",
  TIME_SHIFT: "time_shift",
  FILTER: "filter",
  EXPLANATION: "explanation",
  EXPANSION: "expansion",
  BRANCH_PIVOT: "branch_pivot",
  BRANCH_COMPARE: "branch_compare",
  PRONOUN: "pronoun",
  PERIOD_SWAP: "period_swap",
});

const BRANCH_FRAGMENTS = [
  { id: "khobar", pattern: /\b(khobar|al khobar|nac)\b/i },
  { id: "riyadh", pattern: /\briyadh\b/i },
  { id: "jeddah", pattern: /\bjeddah\b/i },
];

const PERIOD_FRAGMENTS = [
  { pattern: /\blast month\b/i, text: "last month", rangeId: "last_month" },
  { pattern: /\bthis month\b|\bmtd\b|\bmonth to date\b/i, text: "this month", rangeId: "this_month" },
  { pattern: /\byesterday\b/i, text: "yesterday", rangeId: "yesterday" },
  { pattern: /\btoday\b/i, text: "today", rangeId: "today" },
  { pattern: /\blast week\b|\bpast week\b/i, text: "last week", rangeId: "last_week" },
  { pattern: /\bthis week\b/i, text: "this week", rangeId: "this_week" },
  { pattern: /\b(last|past)\s+7\s+days?\b/i, text: "last 7 days", rangeId: "last_7_days" },
  { pattern: /\b(last|past)\s+14\s+days?\b/i, text: "last 14 days", rangeId: "last_14_days" },
  { pattern: /\b(last|past)\s+30\s+days?\b/i, text: "last 30 days", rangeId: "last_30_days" },
];

function normalizeQuestion(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

export function extractBranchFragment(text) {
  for (const item of BRANCH_FRAGMENTS) {
    if (item.pattern.test(String(text || ""))) return item.id;
  }
  return null;
}

export function extractPeriodFragment(text) {
  for (const item of PERIOD_FRAGMENTS) {
    if (item.pattern.test(String(text || ""))) return item;
  }
  return null;
}

/**
 * @returns {{
 *   category: string|null,
 *   subCategory: string|null,
 *   confidence: 'known'|'inferred'|'missing',
 *   signals: string[],
 * }}
 */
export function classifyFollowUp(question = "", state = null) {
  const q = normalizeQuestion(question).toLowerCase();
  const signals = [];
  const hasState = Boolean(state?.resolvedQuestion || state?.intent || state?.metric);

  if (!q) {
    return { category: null, subCategory: null, confidence: "missing", signals };
  }

  if (/\b(visuali[sz]e|chart|graph|plot)\b/.test(q) || /^visuali[sz]e\s+it\b/.test(q) || /^chart\s+it\b/.test(q)) {
    signals.push("visualization_phrase");
    return { category: FOLLOW_UP_CATEGORIES.VISUALIZATION, subCategory: "chart", confidence: hasState ? "known" : "inferred", signals };
  }

  if (/\b(show trend|trend line)\b/.test(q)) {
    signals.push("trend_phrase");
    return { category: FOLLOW_UP_CATEGORIES.VISUALIZATION, subCategory: "trend", confidence: hasState ? "known" : "inferred", signals };
  }

  if (/\b(break\s*(it\s+)?down|daily breakdown)\b/.test(q) || /\bby\s+(day|platform|meal|branch|payment)\b/.test(q)) {
    const byMatch = q.match(/\bby\s+(day|platform|meal(?:\s+period)?|branch|payment(?:\s+method)?)\b/);
    signals.push("drill_down_phrase");
    return {
      category: FOLLOW_UP_CATEGORIES.DRILL_DOWN,
      subCategory: byMatch ? `by_${byMatch[1].replace(/\s+/g, "_")}` : "generic",
      confidence: hasState ? "known" : "inferred",
      signals,
    };
  }

  if (
    /\b(compare|vs|versus|compared to|against)\b/.test(q)
    || /^compare\s+(it|them|both)\b/.test(q)
    || /\bcompare\s+to\b/.test(q)
  ) {
    let subCategory = "generic";
    if (/\b(previous|prior|preceding)\s+week\b/.test(q)) subCategory = "previous_week";
    else if (/\b(last|previous)\s+year\b/.test(q)) subCategory = "last_year";
    else if (/\b(previous|prior)\s+(7|14|30)\s+days?\b/.test(q)) subCategory = "previous_period";
    else if (/\bboth\b/.test(q) || /\bthem\b/.test(q)) subCategory = "branches";
    signals.push("comparison_phrase");
    return { category: FOLLOW_UP_CATEGORIES.COMPARISON, subCategory, confidence: hasState ? "known" : "inferred", signals };
  }

  if (/^(what about|how about)\b/.test(q)) {
    const branch = extractBranchFragment(q);
    if (branch) {
      signals.push("branch_pivot");
      return { category: FOLLOW_UP_CATEGORIES.BRANCH_PIVOT, subCategory: branch, confidence: "known", signals };
    }
    signals.push("topic_pivot");
    return { category: FOLLOW_UP_CATEGORIES.BRANCH_PIVOT, subCategory: "topic", confidence: hasState ? "inferred" : "missing", signals };
  }

  if (/\b(only|just)\b/.test(q) || /\b(delivery only|cash only|card only|hungerstation|jahez|keeta|chefz)\b/.test(q)) {
    signals.push("filter_phrase");
    return { category: FOLLOW_UP_CATEGORIES.FILTER, subCategory: "constraint", confidence: hasState ? "known" : "inferred", signals };
  }

  if (/^why\b/.test(q) || /\b(explain|what happened|what drove|reason for)\b/.test(q)) {
    signals.push("explanation_phrase");
    return { category: FOLLOW_UP_CATEGORIES.EXPLANATION, subCategory: "why", confidence: hasState ? "known" : "missing", signals };
  }

  if (/\b(show more|go deeper|executive summary|detailed view|expand)\b/.test(q)) {
    signals.push("expansion_phrase");
    return { category: FOLLOW_UP_CATEGORIES.EXPANSION, subCategory: "detail", confidence: hasState ? "known" : "inferred", signals };
  }

  if (/^(and )?(yesterday|today|last week|this week|last month|this month|mtd)\??$/.test(q)) {
    signals.push("period_only");
    return { category: FOLLOW_UP_CATEGORIES.TIME_SHIFT, subCategory: "period_only", confidence: hasState ? "known" : "missing", signals };
  }

  if (/\b(it|that|this|them|both)\b/.test(q) && q.split(/\s+/).length <= 8) {
    signals.push("pronoun_reference");
    return { category: FOLLOW_UP_CATEGORIES.PRONOUN, subCategory: "reference", confidence: hasState ? "inferred" : "missing", signals };
  }

  if (/^which\b.*\b(stronger|better|worse|weaker|higher|lower)\b/.test(q)) {
    signals.push("branch_strength");
    return { category: FOLLOW_UP_CATEGORIES.BRANCH_COMPARE, subCategory: "strength", confidence: hasState ? "known" : "missing", signals };
  }

  return { category: null, subCategory: null, confidence: "missing", signals };
}

export function isExecutiveFollowUpFragment(question = "", context = {}) {
  const q = normalizeQuestion(question).toLowerCase();
  if (!q) return false;

  const state = context?.activeState;
  const hasMemory = Boolean(
    context?.lastResolvedQuestion
    || context?.lastQuestion
    || hasActionableState(state),
  );
  if (!hasMemory) return false;

  const classified = classifyFollowUp(question, state || null);
  if (classified.category) return true;

  return false;
}

function hasActionableState(state) {
  return Boolean(state?.resolvedQuestion || state?.intent || state?.metric || state?.period);
}

export function isConversationFollowUp(question = "", context = {}) {
  const q = normalizeQuestion(question).toLowerCase();
  if (!q) return false;

  if (isExecutiveFollowUpFragment(question, context)) return true;

  if (!context?.lastResolvedQuestion && !context?.lastQuestion && !context?.activeState) return false;

  if (/^i mean\b/.test(q)) return true;
  if (/^(what about|how about)\b/.test(q)) return true;
  if (/^and\b/.test(q) && q.split(/\s+/).length <= 6) return true;
  if (/^(show|list|give me|summarize|compare|export)\b/.test(q) && q.split(/\s+/).length <= 8) return true;
  if (/^(and )?(yesterday|last month|this month|today|last week)\??$/.test(q)) return true;
  if (/^summarize them\b/.test(q)) return true;
  if (/^top \d+/i.test(q) && !/\bcategory\b/i.test(q)) return true;

  return false;
}
