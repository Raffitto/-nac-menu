/**
 * Resolve short follow-ups using prior Ask NAC session context.
 */

const PERIOD_FRAGMENTS = [
  { pattern: /\blast month\b/i, text: "last month" },
  { pattern: /\bthis month\b|\bmtd\b|\bmonth to date\b/i, text: "this month" },
  { pattern: /\byesterday\b/i, text: "yesterday" },
  { pattern: /\btoday\b/i, text: "today" },
  { pattern: /\blast week\b|\bpast week\b/i, text: "last week" },
  { pattern: /\bthis week\b/i, text: "this week" },
  { pattern: /\bin may\b/i, text: "in May" },
  { pattern: /\bin june\b/i, text: "in June" },
  { pattern: /\bin july\b/i, text: "in July" },
  { pattern: /\bin august\b/i, text: "in August" },
  { pattern: /\bin september\b/i, text: "in September" },
  { pattern: /\bin october\b/i, text: "in October" },
  { pattern: /\bin november\b/i, text: "in November" },
  { pattern: /\bin december\b/i, text: "in December" },
  { pattern: /\bin january\b/i, text: "in January" },
  { pattern: /\bin february\b/i, text: "in February" },
  { pattern: /\bin march\b/i, text: "in March" },
  { pattern: /\bin april\b/i, text: "in April" },
];

const BRANCH_FRAGMENTS = [
  { id: "khobar", pattern: /\b(khobar|al khobar|nac)\b/i },
  { id: "riyadh", pattern: /\briyadh\b/i },
  { id: "jeddah", pattern: /\bjeddah\b/i },
];

function normalizeQuestion(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function stripQuestionMark(text) {
  return normalizeQuestion(text).replace(/\?+$/, "").trim();
}

function hasExplicitPeriod(text) {
  const q = String(text || "").toLowerCase();
  return PERIOD_FRAGMENTS.some((p) => p.pattern.test(q));
}

function extractPeriodFragment(text) {
  const q = String(text || "");
  for (const item of PERIOD_FRAGMENTS) {
    if (item.pattern.test(q)) return item.text;
  }
  return null;
}

function extractBranchFragment(text) {
  const q = String(text || "").toLowerCase();
  for (const item of BRANCH_FRAGMENTS) {
    if (item.pattern.test(q)) return item.id;
  }
  return null;
}

export function isFollowUpFragment(question, context = {}) {
  const q = normalizeQuestion(question).toLowerCase();
  if (!context?.lastResolvedQuestion && !context?.lastQuestion) return false;

  if (/^i mean\b/.test(q)) return true;
  if (/^(what about|how about)\b/.test(q)) return true;
  if (/^and\b/.test(q) && q.split(/\s+/).length <= 6) return true;
  if (/^(show|list|give me|summarize|compare|export)\b/.test(q) && q.split(/\s+/).length <= 8) {
    return true;
  }
  if (/^(and )?(yesterday|last month|this month|today|last week)\??$/.test(q)) return true;
  if (/^summarize them\b/.test(q)) return true;
  if (/^top \d+/i.test(q) && !/\bcategory\b/i.test(q)) return true;

  return false;
}

function resolvePeriodFollowUp(question, context) {
  const base = stripQuestionMark(context.lastResolvedQuestion || context.lastQuestion);
  const period = extractPeriodFragment(question) || extractPeriodFragment(question.replace(/^i mean\b/i, ""));
  if (!base || !period) return null;

  const withoutPeriod = PERIOD_FRAGMENTS.reduce(
    (acc, item) => acc.replace(item.pattern, ""),
    base,
  )
    .replace(/\s+/g, " ")
    .trim();

  return `${withoutPeriod} ${period}?`.replace(/\?\?+$/, "?");
}

function resolveBranchFollowUp(question, context) {
  const base = stripQuestionMark(context.lastResolvedQuestion || context.lastQuestion);
  const branch = extractBranchFragment(question);
  if (!base || !branch) return null;
  if (/\b(for|in|at)\b/i.test(base) && extractBranchFragment(base)) return null;
  return `${base} for ${branch.charAt(0).toUpperCase()}${branch.slice(1)}?`;
}

function resolveEntityFollowUp(question, context) {
  const q = normalizeQuestion(question).toLowerCase();
  const base = stripQuestionMark(context.lastResolvedQuestion || context.lastQuestion);

  if (/^show top \d+/i.test(q) || /^top \d+ items?/i.test(q)) {
    if (context.lastIntent === "category_sales" && context.lastEntity) {
      return `Show top ${q.match(/\d+/)?.[0] || "10"} items in the ${context.lastEntity} category?`;
    }
  }

  if (/^summarize them\b/i.test(q) && context.lastIntent === "vault_coverage_list") {
    const period = context.lastEntity || context.lastPeriod || "the requested period";
    return `Summarize uploaded files covering ${period}?`;
  }

  if (/^compare them\b/i.test(q) && context.lastIntent === "vault_coverage_list") {
    const period = context.lastEntity || context.lastPeriod || "the requested period";
    return `Compare uploaded files covering ${period}?`;
  }

  if (/^export (that|them|it)\b/i.test(q) && base) {
    return `${base}?`;
  }

  return null;
}

function resolveTemporalSwapFollowUp(question, context) {
  const q = normalizeQuestion(question).toLowerCase();
  const base = stripQuestionMark(context.lastResolvedQuestion || context.lastQuestion);
  if (!base) return null;

  if (/^and yesterday\b/.test(q) && /\btoday\b/i.test(base)) {
    return `${base.replace(/\btoday\b/i, "yesterday")}?`;
  }
  if (/^and today\b/.test(q) && /\byesterday\b/i.test(base)) {
    return `${base.replace(/\byesterday\b/i, "today")}?`;
  }

  return null;
}

/**
 * @returns {{ resolvedQuestion: string, usedContext: boolean, resolutionNotes: string[] }}
 */
export function resolveFollowUpQuestion(question, context = {}) {
  const original = normalizeQuestion(question);
  if (!original) {
    return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] };
  }

  if (!isFollowUpFragment(original, context)) {
    return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] };
  }

  const notes = [];
  const attempts = [
    () => resolvePeriodFollowUp(original, context),
    () => resolveBranchFollowUp(original, context),
    () => resolveTemporalSwapFollowUp(original, context),
    () => resolveEntityFollowUp(original, context),
  ];

  for (const attempt of attempts) {
    const resolved = attempt();
    if (resolved && resolved.toLowerCase() !== original.toLowerCase()) {
      notes.push("Inherited context from the previous question.");
      return { resolvedQuestion: resolved, usedContext: true, resolutionNotes: notes };
    }
  }

  if (/^i mean\b/i.test(original) && context.lastResolvedQuestion) {
    const stripped = original.replace(/^i mean\b/i, "").trim();
    const merged = `${stripQuestionMark(context.lastResolvedQuestion)} ${stripped}`.replace(/\s+/g, " ");
    notes.push("Expanded “I mean …” using the previous question.");
    return { resolvedQuestion: `${merged}?`, usedContext: true, resolutionNotes: notes };
  }

  return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] };
}

export { hasExplicitPeriod, extractPeriodFragment, extractBranchFragment };
