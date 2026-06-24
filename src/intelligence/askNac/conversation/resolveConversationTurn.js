/**
 * Conversation Intelligence V1 — unified follow-up resolver.
 */

import {
  buildBaseQuestionFromState,
  conversationStateFromLegacyContext,
  hasActionableConversationState,
  metricToPhrase,
} from "./conversationState";
import {
  FOLLOW_UP_CATEGORIES,
  classifyFollowUp,
  extractPeriodFragment,
  extractBranchFragment,
  isConversationFollowUp,
} from "./conversationFollowUpTaxonomy";

function normalizeQuestion(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function stripQuestionMark(text) {
  return normalizeQuestion(text).replace(/\?+$/, "").trim();
}

function capitalizeBranch(branchId) {
  if (!branchId) return "";
  return branchId.charAt(0).toUpperCase() + branchId.slice(1);
}

function periodComparePhrase(subCategory, state) {
  const periodType = state?.period?.periodType || state?.period?.rangeId || state?.vaultPeriod?.periodType;
  if (subCategory === "previous_week") return "previous week";
  if (subCategory === "last_year") return "same period last year";
  if (periodType === "last_7_days" || /last 7 days/i.test(state?.period?.label || "")) {
    return "previous 7 days";
  }
  if (periodType === "last_14_days" || /last 14 days/i.test(state?.period?.label || "")) {
    return "previous 14 days";
  }
  if (periodType === "last_30_days" || /last 30 days/i.test(state?.period?.label || "")) {
    return "previous 30 days";
  }
  return "previous period";
}

function currentPeriodPhrase(state) {
  return state?.period?.label || state?.vaultPeriod?.label || "the active period";
}

function resolveVisualization(question, state) {
  const base = buildBaseQuestionFromState(state);
  return {
    resolvedQuestion: `${base} daily breakdown`,
    followUpCategory: FOLLOW_UP_CATEGORIES.VISUALIZATION,
    preferDatasetReuse: Boolean(state?.dataset?.aggregation || state?.dataset?.dailyBreakdown?.length),
    resolutionNotes: [
      "Inherited metric, period, and branch from the previous answer.",
      "Reusing the prior cash-up dataset when available.",
    ],
    confidence: { known: ["metric", "period"], inferred: ["branch"], missing: [] },
  };
}

function resolveDrillDown(question, state, classification) {
  const base = buildBaseQuestionFromState(state);
  const sub = classification.subCategory || "by_day";
  const dimension = sub.replace(/^by_/, "").replace(/_/g, " ");
  return {
    resolvedQuestion: `${base} by ${dimension}`,
    followUpCategory: FOLLOW_UP_CATEGORIES.DRILL_DOWN,
    preferDatasetReuse: dimension === "day" && Boolean(state?.dataset),
    resolutionNotes: [`Drill-down inherited from prior turn (${dimension}).`],
    confidence: { known: ["metric", "period"], inferred: ["dimension"], missing: [] },
  };
}

function resolveComparison(question, state, classification) {
  const metricPhrase = metricToPhrase(state.metric);
  const periodLabel = currentPeriodPhrase(state);
  const branchSuffix = state.branchLabel ? ` for ${state.branchLabel}` : "";

  if (classification.subCategory === "branches" || /\bcompare both\b/i.test(question)) {
    const history = state.branchHistory?.length >= 2
      ? state.branchHistory.slice(-2)
      : [state.branch, extractBranchFragment(state.resolvedQuestion || "")].filter(Boolean);
    if (history.length >= 2) {
      const labels = history.slice(-2).map(capitalizeBranch);
      return {
        resolvedQuestion: `Compare ${labels[0]} and ${labels[1]} ${metricPhrase} for ${periodLabel}`,
        followUpCategory: FOLLOW_UP_CATEGORIES.BRANCH_COMPARE,
        preferDatasetReuse: false,
        resolutionNotes: ["Comparing the two branches referenced in this conversation."],
        confidence: { known: ["branches", "metric", "period"], inferred: [], missing: [] },
      };
    }
  }

  const compareTarget = periodComparePhrase(classification.subCategory, state);
  return {
    resolvedQuestion: `Compare ${metricPhrase} for ${periodLabel} to ${compareTarget}${branchSuffix}`,
    followUpCategory: FOLLOW_UP_CATEGORIES.COMPARISON,
    preferDatasetReuse: false,
    resolutionNotes: ["Inherited metric and period; applied comparison follow-up."],
    confidence: { known: ["metric", "period"], inferred: ["comparison_target"], missing: [] },
  };
}

function stripBranchFromQuestion(text, branchId) {
  if (!branchId) return text;
  const label = capitalizeBranch(branchId);
  return String(text || "")
    .replace(new RegExp(`\\b${label}\\b`, "i"), "")
    .replace(new RegExp(`\\b${branchId}\\b`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveBranchPivot(question, state, classification) {
  const branch = classification.subCategory;
  if (!branch || branch === "topic") return null;
  const base = stripQuestionMark(state.resolvedQuestion || buildBaseQuestionFromState(state));
  const withoutBranch = stripBranchFromQuestion(base, state.branch);
  return {
    resolvedQuestion: `${withoutBranch} for ${capitalizeBranch(branch)}?`,
    followUpCategory: FOLLOW_UP_CATEGORIES.BRANCH_PIVOT,
    branchPivot: branch,
    preferDatasetReuse: false,
    resolutionNotes: [`Switched branch context to ${capitalizeBranch(branch)}.`],
    confidence: { known: ["branch"], inferred: ["metric", "period"], missing: [] },
  };
}

function resolveFilter(question, state) {
  const q = normalizeQuestion(question).toLowerCase();
  const base = stripQuestionMark(state.resolvedQuestion || buildBaseQuestionFromState(state));
  let suffix = "";

  if (/\bdelivery only\b/.test(q) || /\bonly delivery\b/.test(q)) suffix = " delivery only";
  else if (/\bcash only\b/.test(q)) suffix = " cash payments only";
  else if (/\bcard only\b/.test(q)) suffix = " card payments only";
  else if (/\bonly\s+(hungerstation|hunger|jahez|keeta|chefz)\b/.test(q)) {
    const platform = q.match(/\bonly\s+(hungerstation|hunger|jahez|keeta|chefz)\b/)?.[1] || "";
    suffix = ` ${platform} only`;
  } else if (/\b(hungerstation|hunger|jahez|keeta|chefz)\s+only\b/.test(q)) {
    const platform = q.match(/\b(hungerstation|hunger|jahez|keeta|chefz)\b/)?.[1] || "";
    suffix = ` ${platform} only`;
  } else if (/\bonly\b/.test(q)) {
    const topic = q.replace(/^only\s+/i, "").replace(/\?+$/, "").trim();
    if (topic) suffix = ` ${topic} only`;
  }

  if (!suffix) return null;
  return {
    resolvedQuestion: `${base}${suffix}?`,
    followUpCategory: FOLLOW_UP_CATEGORIES.FILTER,
    preferDatasetReuse: false,
    resolutionNotes: ["Applied filter on top of the active conversation context."],
    confidence: { known: ["filter"], inferred: ["metric", "period", "branch"], missing: [] },
  };
}

function resolveExplanation(question, state) {
  const metricPhrase = metricToPhrase(state.metric);
  const periodLabel = currentPeriodPhrase(state);
  const branchSuffix = state.branchLabel ? ` for ${state.branchLabel}` : "";
  const q = normalizeQuestion(question).toLowerCase();

  if (/worst day|weakest day|lowest day/.test(q)) {
    const breakdown = state?.dataset?.dailyBreakdown
      || state?.dataset?.aggregation?.dailyBreakdown
      || [];
    if (breakdown.length) {
      const rows = [...breakdown].filter((r) => r.totalSales != null || r.netSales != null);
      rows.sort((a, b) => Number(a.totalSales ?? a.netSales) - Number(b.totalSales ?? b.netSales));
      const worst = rows[0];
      if (worst?.date) {
        return {
          resolvedQuestion: `Why were ${metricPhrase} lower on ${worst.date}${branchSuffix}?`,
          followUpCategory: FOLLOW_UP_CATEGORIES.EXPLANATION,
          preferDatasetReuse: true,
          resolutionNotes: ["Explanation anchored to the weakest day in the prior dataset."],
          confidence: { known: ["worst_day", "metric"], inferred: ["period", "branch"], missing: [] },
        };
      }
    }
  }

  if (/^why\b/.test(q) && q.length < 12) {
    return {
      resolvedQuestion: `Why did ${metricPhrase} change for ${periodLabel}${branchSuffix}?`,
      followUpCategory: FOLLOW_UP_CATEGORIES.EXPLANATION,
      preferDatasetReuse: Boolean(state?.dataset),
      resolutionNotes: ["Expanded bare “why” using prior metric and period."],
      confidence: { known: ["metric", "period"], inferred: ["branch"], missing: ["driver_detail"] },
    };
  }

  return {
    resolvedQuestion: `Why were ${metricPhrase} down for ${periodLabel}${branchSuffix}?`,
    followUpCategory: FOLLOW_UP_CATEGORIES.EXPLANATION,
    preferDatasetReuse: Boolean(state?.dataset),
    resolutionNotes: ["Inherited metric and period for explanation routing."],
    confidence: { known: ["metric", "period"], inferred: ["branch"], missing: [] },
  };
}

function resolveTimeShift(question, state) {
  const base = stripQuestionMark(state.resolvedQuestion || buildBaseQuestionFromState(state));
  const period = extractPeriodFragment(question);
  if (!period) return null;

  let withoutPeriod = base;
  const periodPatterns = [
    /\blast month\b/i, /\bthis month\b/i, /\byesterday\b/i, /\btoday\b/i,
    /\blast week\b/i, /\bthis week\b/i, /\b(last|past)\s+\d+\s+days?\b/i,
  ];
  for (const pattern of periodPatterns) {
    withoutPeriod = withoutPeriod.replace(pattern, "");
  }
  withoutPeriod = withoutPeriod.replace(/\s+/g, " ").trim();

  return {
    resolvedQuestion: `${withoutPeriod} ${period.text}?`,
    followUpCategory: FOLLOW_UP_CATEGORIES.TIME_SHIFT,
    preferDatasetReuse: false,
    resolutionNotes: [`Shifted period to ${period.text}.`],
    confidence: { known: ["period"], inferred: ["metric", "branch"], missing: [] },
  };
}

function resolveBranchStrength(question, state) {
  if (!state.branchHistory || state.branchHistory.length < 2) {
    return {
      resolvedQuestion: `Compare ${metricToPhrase(state.metric)} for ${currentPeriodPhrase(state)} across branches`,
      followUpCategory: FOLLOW_UP_CATEGORIES.BRANCH_COMPARE,
      preferDatasetReuse: false,
      resolutionNotes: ["Insufficient branch history — broadened to branch comparison."],
      confidence: { known: ["metric", "period"], inferred: [], missing: ["branch_pair"] },
    };
  }
  const labels = state.branchHistory.slice(-2).map(capitalizeBranch);
  return {
    resolvedQuestion: `Compare ${labels[0]} and ${labels[1]} ${metricToPhrase(state.metric)} for ${currentPeriodPhrase(state)} — which is stronger?`,
    followUpCategory: FOLLOW_UP_CATEGORIES.BRANCH_COMPARE,
    preferDatasetReuse: false,
    resolutionNotes: ["Strength question mapped to branch comparison."],
    confidence: { known: ["branches", "metric", "period"], inferred: [], missing: [] },
  };
}

function resolvePronoun(question, state, classification) {
  if (classification.category === FOLLOW_UP_CATEGORIES.PRONOUN) {
    const q = normalizeQuestion(question).toLowerCase();
    if (/^compare\s+it\b/.test(q)) {
      return resolveComparison(question, state, { subCategory: "previous_period" });
    }
    if (/^visuali[sz]e\s+it\b/.test(q) || /^chart\s+it\b/.test(q)) {
      return resolveVisualization(question, state);
    }
    if (/^break\s+it\s+down\b/.test(q)) {
      return resolveDrillDown(question, state, { subCategory: "by_day" });
    }
  }
  return null;
}

/**
 * @returns {{
 *   resolvedQuestion: string,
 *   usedContext: boolean,
 *   resolutionNotes: string[],
 *   followUpCategory?: string,
 *   preferDatasetReuse?: boolean,
 *   confidence?: { known: string[], inferred: string[], missing: string[] },
 * }}
 */
export function resolveConversationTurn(question, context = {}) {
  const original = normalizeQuestion(question);
  if (!original) {
    return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] };
  }

  const state = conversationStateFromLegacyContext(context);
  if (!hasActionableConversationState(state) && !isConversationFollowUp(original, context)) {
    return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] };
  }

  const classification = classifyFollowUp(original, state);
  if (!classification.category) {
    return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] };
  }

  let result = null;
  switch (classification.category) {
    case FOLLOW_UP_CATEGORIES.VISUALIZATION:
      result = resolveVisualization(original, state);
      break;
    case FOLLOW_UP_CATEGORIES.DRILL_DOWN:
      result = resolveDrillDown(original, state, classification);
      break;
    case FOLLOW_UP_CATEGORIES.COMPARISON:
      result = resolveComparison(original, state, classification);
      break;
    case FOLLOW_UP_CATEGORIES.BRANCH_PIVOT:
      result = resolveBranchPivot(original, state, classification);
      break;
    case FOLLOW_UP_CATEGORIES.FILTER:
      result = resolveFilter(original, state);
      break;
    case FOLLOW_UP_CATEGORIES.EXPLANATION:
      result = resolveExplanation(original, state);
      break;
    case FOLLOW_UP_CATEGORIES.TIME_SHIFT:
      result = resolveTimeShift(original, state);
      break;
    case FOLLOW_UP_CATEGORIES.BRANCH_COMPARE:
      result = resolveBranchStrength(original, state);
      break;
    case FOLLOW_UP_CATEGORIES.PRONOUN:
      result = resolvePronoun(original, state, classification);
      break;
    default:
      break;
  }

  if (!result?.resolvedQuestion) {
    return { resolvedQuestion: original, usedContext: false, resolutionNotes: [] };
  }

  return {
    resolvedQuestion: normalizeQuestion(result.resolvedQuestion),
    usedContext: true,
    resolutionNotes: result.resolutionNotes || ["Inherited context from the previous answer."],
    followUpCategory: result.followUpCategory || classification.category,
    preferDatasetReuse: Boolean(result.preferDatasetReuse),
    confidence: result.confidence || {
      known: [],
      inferred: ["metric", "period", "branch"],
      missing: [],
    },
  };
}

export { isConversationFollowUp, classifyFollowUp };
