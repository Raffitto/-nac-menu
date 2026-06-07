/**
 * Edge-side Ask NAC conversation follow-up resolution (mirrors client conversation module).
 */

const PERIOD_FRAGMENTS = [
  { pattern: /\blast month\b/i, text: "last month" },
  { pattern: /\bthis month\b|\bmtd\b|\bmonth to date\b/i, text: "this month" },
  { pattern: /\byesterday\b/i, text: "yesterday" },
  { pattern: /\btoday\b/i, text: "today" },
  { pattern: /\blast week\b|\bpast week\b/i, text: "last week" },
  { pattern: /\bthis week\b/i, text: "this week" },
];

const BRANCH_FRAGMENTS = [
  { id: "khobar", pattern: /\b(khobar|al khobar|nac)\b/i },
  { id: "riyadh", pattern: /\briyadh\b/i },
  { id: "jeddah", pattern: /\bjeddah\b/i },
];

function normalizeQuestion(text: string) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function stripQuestionMark(text: string) {
  return normalizeQuestion(text).replace(/\?+$/, "").trim();
}

function extractPeriodFragment(text: string) {
  for (const item of PERIOD_FRAGMENTS) {
    if (item.pattern.test(text)) return item.text;
  }
  return null;
}

function extractBranchFragment(text: string) {
  for (const item of BRANCH_FRAGMENTS) {
    if (item.pattern.test(text)) return item.id;
  }
  return null;
}

export function isFollowUpFragment(question: string, context: Record<string, unknown> = {}) {
  const q = normalizeQuestion(question).toLowerCase();
  if (!context?.lastResolvedQuestion && !context?.lastQuestion) return false;
  if (/^i mean\b/.test(q)) return true;
  if (/^(what about|how about)\b/.test(q)) return true;
  if (/^and\b/.test(q) && q.split(/\s+/).length <= 6) return true;
  if (/^(show|list|give me|summarize|compare|export)\b/.test(q) && q.split(/\s+/).length <= 8) return true;
  if (/^(and )?(yesterday|last month|this month|today|last week)\??$/.test(q)) return true;
  if (/^summarize them\b/.test(q)) return true;
  if (/^top \d+/i.test(q) && !/\bcategory\b/i.test(q)) return true;
  return false;
}

export function resolveFollowUpQuestion(question: string, context: Record<string, unknown> = {}) {
  const original = normalizeQuestion(question);
  if (!original || !isFollowUpFragment(original, context)) {
    return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] as string[] };
  }

  const base = stripQuestionMark(String(context.lastResolvedQuestion || context.lastQuestion || ""));
  const period = extractPeriodFragment(original) || extractPeriodFragment(original.replace(/^i mean\b/i, ""));
  if (base && period) {
    let withoutPeriod = base;
    for (const item of PERIOD_FRAGMENTS) {
      withoutPeriod = withoutPeriod.replace(item.pattern, "");
    }
    withoutPeriod = withoutPeriod.replace(/\s+/g, " ").trim();
    return {
      resolvedQuestion: `${withoutPeriod} ${period}?`.replace(/\?\?+$/, "?"),
      usedContext: true,
      resolutionNotes: ["Inherited context from the previous question."],
    };
  }

  const branch = extractBranchFragment(original);
  if (base && branch && !extractBranchFragment(base)) {
    return {
      resolvedQuestion: `${base} for ${branch.charAt(0).toUpperCase()}${branch.slice(1)}?`,
      usedContext: true,
      resolutionNotes: ["Inherited context from the previous question."],
    };
  }

  if (/^and yesterday\b/i.test(original) && /\btoday\b/i.test(base)) {
    return {
      resolvedQuestion: `${base.replace(/\btoday\b/i, "yesterday")}?`,
      usedContext: true,
      resolutionNotes: ["Inherited context from the previous question."],
    };
  }

  if (/^show top \d+/i.test(original) && context.lastIntent === "category_sales" && context.lastEntity) {
    const limit = original.match(/\d+/)?.[0] || "10";
    return {
      resolvedQuestion: `Show top ${limit} items in the ${context.lastEntity} category?`,
      usedContext: true,
      resolutionNotes: ["Inherited context from the previous question."],
    };
  }

  if (/^summarize them\b/i.test(original) && context.lastIntent === "vault_coverage_list") {
    const period = context.lastEntity || context.lastPeriod || "the requested period";
    return {
      resolvedQuestion: `Summarize uploaded files covering ${period}?`,
      usedContext: true,
      resolutionNotes: ["Inherited context from the previous question."],
    };
  }

  if (/^i mean\b/i.test(original) && context.lastResolvedQuestion) {
    const stripped = original.replace(/^i mean\b/i, "").trim();
    const merged = `${stripQuestionMark(String(context.lastResolvedQuestion))} ${stripped}`.replace(/\s+/g, " ");
    return {
      resolvedQuestion: `${merged}?`,
      usedContext: true,
      resolutionNotes: ["Expanded “I mean …” using the previous question."],
    };
  }

  return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] as string[] };
}

export function prepareAskNacQuestionEdge({
  question,
  conversationContext = null,
  filters = {},
}: {
  question: string;
  conversationContext?: Record<string, unknown> | null;
  filters?: Record<string, unknown>;
}) {
  const resolution = conversationContext
    ? resolveFollowUpQuestion(question, conversationContext)
    : { resolvedQuestion: question, usedContext: false, resolutionNotes: [] as string[] };

  const effectiveQuestion = resolution.resolvedQuestion || question;
  const effectiveFilters = { ...filters };

  if (resolution.usedContext && conversationContext?.lastPeriod && !effectiveFilters.selectedRange) {
    effectiveFilters.selectedRange = conversationContext.lastPeriod;
  }

  return {
    originalQuestion: question,
    effectiveQuestion,
    conversationResolution: resolution,
    filters: effectiveFilters,
  };
}
