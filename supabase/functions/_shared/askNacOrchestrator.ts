/**
 * Ask NAC Edge orchestrator — route → query tools → deterministic answer → optional AI narration.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchAskNacMenuMetrics } from "./askNacMenuMetrics.ts";
import { MONTH_HOURS } from "./mtdHybridMerge.ts";
import { buildDeterministicAskNacAnswer, branchDisplayName, MAX_BRANCH_ROWS, MAX_STAFF_ROWS, periodLabelFromHours } from "./askNacEdgeAnswerBuilder.ts";
import { narrateWithOpenAi } from "./askNacOpenAiNarrator.ts";
import {
  compareFoodicsTopItems,
  getFoodicsBranchSalesComparison,
  getFoodicsCategorySales,
  getFoodicsSalesSummary,
  getFoodicsTopItems,
} from "./askNacFoodicsTools.ts";
import {
  detectRankChangeDirection,
  detectRankingBasis,
  detectTopLimit,
  parseFoodicsComparePeriods,
  parseFoodicsPeriodFromQuestion,
  resolveFoodicsPeriodWithFallback,
} from "./askNacPeriodFallback.ts";
import {
  buildVaultAnswer,
  hasVaultDayPeriod,
  isVaultDataIntent,
  parseVaultPeriodFromQuestion,
  runVaultQueryTool,
  VAULT_INTENTS,
} from "./askNacVaultTools.ts";

export const ASK_NAC_INTENTS = {
  MENU_QR_SCANS: "menu_qr_scans",
  MENU_SESSIONS: "menu_sessions",
  GOOGLE_REDIRECTS: "google_redirects",
  REVIEW_QR_SCANS: "review_qr_scans",
  STAFF_REDIRECT_LEADERBOARD: "staff_redirect_leaderboard",
  BRANCH_COMPARISON: "branch_comparison",
  SALES_TOTAL: "sales_total",
  TOP_ITEMS: "top_items",
  TOP_ITEMS_COMPARE: "top_items_compare",
  ITEM_RANK_CHANGE: "item_rank_change",
  CATEGORY_SALES: "category_sales",
  BRANCH_SALES: "branch_sales",
  AVG_SPEND_PER_GUEST: "avg_spend_per_guest",
  DELIVERY_SALES: "delivery_sales",
  GOOGLE_REVIEWS: "google_reviews",
  FOODICS_QUERY: "foodics_query",
  ...VAULT_INTENTS,
  UNKNOWN: "unknown",
} as const;

const FOODICS_SALES_SIGNAL =
  /\b(sales|revenue|sold|net sales|gross sales|pos sales|foodics|waiter sales|product sales|top items?|best sellers?|category|categories)\b/;

const BRANCH_ALIASES: Record<string, string[]> = {
  khobar: ["khobar", "al khobar", "alkhobar"],
  riyadh: ["riyadh", "riyad"],
  jeddah: ["jeddah", "jedda"],
};

const INTENT_RULES: { id: string; score: (q: string) => number }[] = [
  {
    id: ASK_NAC_INTENTS.VAULT_MANAGEMENT_REPORT,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(management report|generate report|executive report)\b/.test(q)) return 20;
      if (/\b(summarize|summary report).*\b(operation|branch)\b/.test(q) && /\b(report)\b/.test(q)) return 18;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)?.isSingleDay) return 0;
      if (/\b(what happened|summarize|summary|operational day|day summary)\b/.test(q)) return 19;
      if (/\b(operation|operational)\b/.test(q) && /\b(on|for)\b/.test(q)) return 17;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_COVERAGE_LIST,
    score(q) {
      if (/\b(which uploaded files|uploaded files cover|files cover|data coverage|what data do we have)\b/.test(q)) return 18;
      if (/\b(coverage|uploaded data)\b/.test(q) && parseVaultPeriodFromQuestion(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_GOOGLE_STARS,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(5[\s-]?star|five star|google review star|star reviews?)\b/.test(q)) return 17;
      if (/\bgoogle reviews?\b/.test(q) && hasVaultDayPeriod(q)) return 14;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_RECEPTION,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(reservations?|covers|walk[\s-]?ins?|no[\s-]?shows?|cancellations?|reception)\b/.test(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_CCM,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(ccm|reconciliation|reconcile)\b/.test(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_CASH_UP,
    score(q) {
      const period = parseVaultPeriodFromQuestion(q);
      if (!period?.isSingleDay) return 0;
      if (/\b(sales|revenue|guests?|guest count|orders?|avg|average spend|cash[\s-]?up)\b/.test(q)) return 16;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.VAULT_LOGBOOK,
    score(q) {
      if (!parseVaultPeriodFromQuestion(q)) return 0;
      if (/\b(logbook|complaints?|training notes?|mod on duty|chef on duty|operational issues?)\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST,
    score(q) {
      if (/\b(avg|average|mean)\b.*\b(spend|spending|ticket|check)\b.*\b(guest|customer|cover)\b/.test(q)) return 14;
      if (/\b(spend per guest|average spend|avg spend|guest spend)\b/.test(q)) return 14;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.DELIVERY_SALES,
    score(q) {
      if (/\b(delivery|hungerstation|jahez|talabat|keeta|aggregator)\b/.test(q)) return 12;
      if (/\b(platform sales|delivery sales|delivery revenue)\b/.test(q)) return 13;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.GOOGLE_REVIEWS,
    score(q) {
      if (hasVaultDayPeriod(q) && /\b(star|stars)\b/.test(q)) return 0;
      if (/\b(actual google review|published review|new google review|google review count)\b/.test(q)) return 14;
      if (/\bgoogle reviews\b/.test(q) && !/\bredirect\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.ITEM_RANK_CHANGE,
    score(q) {
      if (/\b(entered|joined|new in|moved into)\b.*\btop\b/.test(q)) return 16;
      if (/\b(dropped|fell|left|removed from)\b.*\btop\b/.test(q)) return 16;
      if (/\b(which item).*(entered|dropped|left|joined)\b.*\btop\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.TOP_ITEMS_COMPARE,
    score(q) {
      if (/\b(compare|compared|vs|versus|against)\b.*\btop\b/.test(q)) return 14;
      if (/\btop\b.*\b(compare|compared|vs|versus|between|two months)\b/.test(q)) return 13;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.TOP_ITEMS,
    score(q) {
      if (/\b(top \d+|top ten|best sellers?|top items?|highest selling|most sold)\b/.test(q)) return 14;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.CATEGORY_SALES,
    score(q) {
      if (/\b(category|categories)\b.*\b(sales|revenue|sold|most|highest|generated)\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.BRANCH_SALES,
    score(q) {
      if (!FOODICS_SALES_SIGNAL.test(q)) return 0;
      if (/\b(sales|revenue).*\b(by branch|each branch|per branch|all branches)\b/.test(q)) return 14;
      if (/\b(which branch).*(sales|revenue|sold most)\b/.test(q)) return 14;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.SALES_TOTAL,
    score(q) {
      if (hasVaultDayPeriod(q)) return 0;
      if (/\b(total sales|sales total|what were sales|how much sales|sales in|sales for|revenue in|revenue for)\b/.test(q)) return 13;
      if (FOODICS_SALES_SIGNAL.test(q) && /\b(total|how much|what were)\b/.test(q) && !/\btop\b/.test(q)) return 11;
      if (/\bfoodics\b/.test(q) && /\b(sales|revenue)\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.FOODICS_QUERY,
    score(q) {
      if (/\bfoodics\b/.test(q)) return 8;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD,
    score(q) {
      if (/\b(staff|waiter|waitress|server|employee).*(leaderboard|top|best|rank|drove|drive|most)\b/.test(q)) return 14;
      if (/\b(who|which).*(staff|waiter|employee).*(redirect|google)\b/.test(q)) return 15;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.BRANCH_COMPARISON,
    score(q) {
      if (/\bcompare branches\b/.test(q)) return 15;
      if (/\b(khobar|riyadh|jeddah).*(vs|versus|compare|outperform)\b/.test(q)) return 14;
      if (/\b(branch|branches|location).*(compare|comparison|strongest|weakest)\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.GOOGLE_REDIRECTS,
    score(q) {
      if (/\b(staff|waiter|employee|who|which)\b/.test(q)) return 0;
      if (/\bgoogle redirect/.test(q)) return 14;
      if (/\b(redirect|redirects)\b/.test(q) && /\b(google|review page)\b/.test(q)) return 12;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.REVIEW_QR_SCANS,
    score(q) {
      if (/\b(review qr|review card|review portal).*(scan|tap|open)\b/.test(q)) return 14;
      if (/\b(review qr scans|review scans)\b/.test(q)) return 13;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.MENU_QR_SCANS,
    score(q) {
      if (/\b(menu qr|menu scan|qr scan).*\b(menu|digital menu)\b/.test(q)) return 14;
      if (/\b(menu qr scans|menu scans|qr scans)\b/.test(q) && !/\breview\b/.test(q)) return 13;
      return 0;
    },
  },
  {
    id: ASK_NAC_INTENTS.MENU_SESSIONS,
    score(q) {
      if (/\b(menu session|menu sessions|digital menu session)\b/.test(q)) return 14;
      if (/\b(session count|total sessions|guest sessions)\b/.test(q) && !/\breview\b/.test(q)) return 10;
      return 0;
    },
  },
];

function parseAskNacPeriod(question = "", fallbackHours = 24) {
  const q = String(question || "").toLowerCase();
  if (/\b(this month|month to date|month-to-date|mtd)\b/.test(q)) {
    return { hours: MONTH_HOURS, rangeId: "month", source: "question" };
  }
  if (/\b(last 7|7d|7 days|past week|this week)\b/.test(q)) {
    return { hours: 168, rangeId: "7d", source: "question" };
  }
  if (/\b(today|business day)\b/.test(q)) return { hours: 24, rangeId: "today", source: "question" };
  const fb = Number(fallbackHours) || 24;
  const rangeId = fb === MONTH_HOURS ? "month" : fb >= 168 ? "7d" : "today";
  return { hours: fb, rangeId, source: "filters" };
}

function parseAskNacBranch(question = "") {
  const q = String(question || "").toLowerCase();
  for (const [id, aliases] of Object.entries(BRANCH_ALIASES)) {
    if (aliases.some((a) => q.includes(a))) return id;
  }
  return null;
}

function isFoodicsDataIntent(intent: string) {
  return [
    ASK_NAC_INTENTS.SALES_TOTAL,
    ASK_NAC_INTENTS.TOP_ITEMS,
    ASK_NAC_INTENTS.TOP_ITEMS_COMPARE,
    ASK_NAC_INTENTS.ITEM_RANK_CHANGE,
    ASK_NAC_INTENTS.CATEGORY_SALES,
    ASK_NAC_INTENTS.BRANCH_SALES,
    ASK_NAC_INTENTS.FOODICS_QUERY,
  ].includes(intent as typeof ASK_NAC_INTENTS[keyof typeof ASK_NAC_INTENTS]);
}

function isFoodicsCompareIntent(intent: string) {
  return [ASK_NAC_INTENTS.TOP_ITEMS_COMPARE, ASK_NAC_INTENTS.ITEM_RANK_CHANGE].includes(
    intent as typeof ASK_NAC_INTENTS[keyof typeof ASK_NAC_INTENTS],
  );
}

function isMissingDataIntent(intent: string) {
  return [
    ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST,
    ASK_NAC_INTENTS.DELIVERY_SALES,
    ASK_NAC_INTENTS.GOOGLE_REVIEWS,
  ].includes(intent as typeof ASK_NAC_INTENTS[keyof typeof ASK_NAC_INTENTS]);
}

export function routeIntent(question: string, options: { fallbackHours?: number } = {}) {
  const q = String(question || "").trim().toLowerCase();
  const period = parseAskNacPeriod(question, options.fallbackHours ?? 24);
  const branchMention = parseAskNacBranch(question);

  if (!q) {
    return {
      intent: ASK_NAC_INTENTS.UNKNOWN,
      confidence: "none",
      score: 0,
      period,
      branchMention,
      debug: { reason: "empty_question" },
    };
  }

  const scored = INTENT_RULES.map((rule) => ({ id: rule.id, score: rule.score(q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const MIN = 8;
  let intent: string = ASK_NAC_INTENTS.UNKNOWN;
  let score = 0;

  if (scored.length && scored[0].score >= MIN) {
    intent = scored[0].id;
    score = scored[0].score;
  } else if (/\b(session|sessions)\b/.test(q) && !/\breview\b/.test(q)) {
    intent = ASK_NAC_INTENTS.MENU_SESSIONS;
    score = 6;
  } else if (/\b(qr|scan|scans)\b/.test(q) && !/\breview\b/.test(q)) {
    intent = ASK_NAC_INTENTS.MENU_QR_SCANS;
    score = 6;
  }

  const confidence = score >= 12 ? "high" : score >= 8 ? "medium" : score > 0 ? "low" : "none";
  const foodicsPeriod = isFoodicsDataIntent(intent) ? parseFoodicsPeriodFromQuestion(question) : null;
  const foodicsCompare = isFoodicsCompareIntent(intent) ? parseFoodicsComparePeriods(question) : null;
  const rankingBasis = isFoodicsDataIntent(intent) ? detectRankingBasis(question) : null;
  const topLimit = isFoodicsDataIntent(intent) ? detectTopLimit(question) : null;
  const rankChangeDirection = intent === ASK_NAC_INTENTS.ITEM_RANK_CHANGE
    ? detectRankChangeDirection(question)
    : null;
  const vaultPeriod = parseVaultPeriodFromQuestion(question);

  return {
    intent,
    confidence,
    score,
    period,
    branchMention,
    foodicsPeriod,
    foodicsCompare,
    rankingBasis,
    topLimit,
    rankChangeDirection,
    vaultPeriod,
    debug: {
      topMatches: scored.slice(0, 3),
      branchLabel: branchMention ? branchDisplayName(branchMention) : null,
      periodHours: period.hours,
      rangeId: period.rangeId,
      foodicsPeriod,
      vaultPeriod,
      rankingBasis,
      topLimit,
    },
  };
}

function assessReadiness(route: ReturnType<typeof routeIntent>) {
  if (isMissingDataIntent(route.intent)) {
    const labels: Record<string, string> = {
      [ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST]: "Average spend per guest",
      [ASK_NAC_INTENTS.DELIVERY_SALES]: "Delivery platform sales",
      [ASK_NAC_INTENTS.GOOGLE_REVIEWS]: "Actual Google reviews",
    };
    return {
      status: "missing",
      canQuery: false,
      reasons: [`${labels[route.intent] || route.intent} is not wired in Edge yet.`],
      missingData: [{ intent: route.intent, label: labels[route.intent] || route.intent }],
    };
  }
  if (route.intent === ASK_NAC_INTENTS.UNKNOWN) {
    return { status: "missing", canQuery: false, reasons: ["Could not map question to a supported intent."], missingData: [] };
  }
  if (isVaultDataIntent(route.intent) && (!route.vaultPeriod?.startDate || !route.vaultPeriod?.endDate)) {
    return {
      status: "missing",
      canQuery: false,
      reasons: ["Could not parse a calendar day or month for this vault question."],
      missingData: [{ intent: route.intent, label: "Vault period" }],
    };
  }
  return { status: "ready", canQuery: true, reasons: [], missingData: [] };
}

function resolveBranch(context: Record<string, unknown>) {
  const profile = context.profile as { branchScope?: string; allBranches?: boolean } | undefined;
  if (profile?.branchScope && !profile.allBranches) return profile.branchScope;
  return (context.branchMention as string) || (context.filters as { branch?: string })?.branch || (context.branch as string) || null;
}

async function queryReviewMetrics(supabase: SupabaseClient, context: Record<string, unknown>) {
  const hours = Number(context.hours) || 24;
  const branch = resolveBranch(context);
  const { data, error } = await supabase.rpc("get_review_events_summary", {
    p_branch: branch,
    p_hours: hours,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const staff = Array.isArray(row?.staff) ? row.staff : [];
  const byBranch = Array.isArray(row?.by_branch) ? row.by_branch : [];

  return {
    hours,
    branch,
    branchLabel: branch ? branchDisplayName(branch) : "Network (all branches)",
    periodLabel: periodLabelFromHours(hours),
    reviewQrScans: Number(row?.qr_scans) || 0,
    googleRedirects: Number(row?.google_redirects) || 0,
    staffMerged: staff,
    branchComparison: byBranch,
    sources: [{ name: "get_review_events_summary", detail: "verified RPC" }],
    warnings: [] as string[],
  };
}

async function queryMenuMetrics(supabase: SupabaseClient, context: Record<string, unknown>) {
  const hours = Number(context.hours) || 24;
  const branch = resolveBranch(context);
  const metrics = await fetchAskNacMenuMetrics(supabase, { branch, hours });
  return {
    hours,
    branch,
    branchLabel: branch ? branchDisplayName(branch) : "Network (all branches)",
    periodLabel: periodLabelFromHours(hours),
    menuQrScans: metrics.menuQrScans,
    menuSessions: metrics.menuSessions,
    partial: metrics.partial,
    note: metrics.note,
    dataSource: metrics.dataSource,
    mtdHybrid: metrics.mtdHybrid,
    warnings: metrics.warnings,
    sources: [{ name: metrics.rpc || "fetchAskNacMenuMetrics", detail: metrics.dataSource || "live/rollup/hybrid" }],
  };
}

async function queryStaffLeaderboard(supabase: SupabaseClient, context: Record<string, unknown>) {
  const review = await queryReviewMetrics(supabase, context);
  const leaderboard = (review.staffMerged as Record<string, unknown>[])
    .map((s) => ({
      name: s.name,
      role: s.role || "",
      branch: s.branch,
      googleRedirects: Number(s.google) || 0,
      reviewQrScans: Number(s.scans) || 0,
    }))
    .filter((r) => r.googleRedirects > 0 || r.reviewQrScans > 0)
    .sort((a, b) => b.googleRedirects - a.googleRedirects || b.reviewQrScans - a.reviewQrScans)
    .slice(0, MAX_STAFF_ROWS);

  return { ...review, leaderboard };
}

async function queryBranchComparison(supabase: SupabaseClient, context: Record<string, unknown>) {
  const hours = Number(context.hours) || 24;
  const useRollup = hours >= 168 || hours === MONTH_HOURS;
  const rpc = useRollup ? "get_branch_comparison_from_rollup" : "get_branch_comparison";
  const { data, error } = await supabase.rpc(rpc, { p_hours: hours });
  if (error) throw error;
  const menuRows = (Array.isArray(data) ? data : []).slice(0, MAX_BRANCH_ROWS);

  const review = await queryReviewMetrics(supabase, { ...context, branch: null });
  const reviewByBranch = new Map(
    ((review.branchComparison as Record<string, unknown>[]) || []).map((r) => [String(r.branch_id), r]),
  );

  const rows = menuRows.map((row: Record<string, unknown>) => {
    const id = row.branch_id;
    const rev = reviewByBranch.get(String(id)) || {};
    return {
      branch_id: id,
      branchLabel: branchDisplayName(String(id)),
      menuSessions: Number(row.sessions) || 0,
      menuImpressions: Number(row.impressions) || 0,
      menuOpens: Number(row.opens) || 0,
      reviewQrScans: Number(rev.qr_scans) || 0,
      googleRedirects: Number(rev.google_redirects) || 0,
    };
  }).sort((a, b) => b.menuSessions - a.menuSessions);

  return {
    hours,
    periodLabel: periodLabelFromHours(hours),
    rows,
    sources: [
      { name: rpc, detail: "branch comparison RPC" },
      { name: "get_review_events_summary", detail: "review by_branch slice" },
    ],
    warnings: [],
  };
}

async function runQueryTool(
  supabase: SupabaseClient,
  intent: string,
  context: Record<string, unknown>,
) {
  if (isVaultDataIntent(intent)) {
    return runVaultQueryTool(supabase, intent, context);
  }

  switch (intent) {
    case ASK_NAC_INTENTS.MENU_QR_SCANS:
    case ASK_NAC_INTENTS.MENU_SESSIONS:
      return queryMenuMetrics(supabase, context);
    case ASK_NAC_INTENTS.GOOGLE_REDIRECTS:
    case ASK_NAC_INTENTS.REVIEW_QR_SCANS:
      return queryReviewMetrics(supabase, context);
    case ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD:
      return queryStaffLeaderboard(supabase, context);
    case ASK_NAC_INTENTS.BRANCH_COMPARISON:
      return queryBranchComparison(supabase, context);
    case ASK_NAC_INTENTS.SALES_TOTAL:
    case ASK_NAC_INTENTS.FOODICS_QUERY:
      return getFoodicsSalesSummary(supabase, context);
    case ASK_NAC_INTENTS.TOP_ITEMS:
      return getFoodicsTopItems(supabase, context);
    case ASK_NAC_INTENTS.TOP_ITEMS_COMPARE:
    case ASK_NAC_INTENTS.ITEM_RANK_CHANGE:
      return compareFoodicsTopItems(supabase, context);
    case ASK_NAC_INTENTS.CATEGORY_SALES:
      return getFoodicsCategorySales(supabase, context);
    case ASK_NAC_INTENTS.BRANCH_SALES:
      return getFoodicsBranchSalesComparison(supabase, context);
    default:
      return null;
  }
}

export async function processAskNacOnEdge(
  supabase: SupabaseClient,
  {
    question,
    branch = null,
    hours,
    range,
    profileHint = null,
    filters = {},
  }: {
    question: string;
    branch?: string | null;
    hours?: number;
    range?: string;
    profileHint?: Record<string, unknown> | null;
    filters?: Record<string, unknown>;
  },
) {
  const mergedFilters = {
    ...filters,
    branch: branch ?? (filters.branch as string | null) ?? null,
    timeRangeHours: hours ?? filters.timeRangeHours,
    selectedRange: range ?? filters.selectedRange,
  };

  const fallbackHours = Number(mergedFilters.timeRangeHours) || 24;
  const route = routeIntent(question, { fallbackHours });
  const readiness = assessReadiness(route);

  let foodicsPeriod = route.foodicsPeriod;
  let periodWarnings: string[] = [];

  if (isFoodicsDataIntent(route.intent)) {
    const fallback = await resolveFoodicsPeriodWithFallback(supabase, {
      question,
      filters: mergedFilters,
      branch: (route.branchMention || mergedFilters.branch) as string | null,
      profileHint,
    });
    if (!foodicsPeriod && fallback.period) foodicsPeriod = fallback.period;
    periodWarnings = fallback.warnings;
    if (foodicsPeriod) route.foodicsPeriod = foodicsPeriod;
  }

  let tool: Record<string, unknown> | null = null;
  if (readiness.canQuery) {
    tool = await runQueryTool(supabase, route.intent, {
      hours: route.period.hours,
      period: route.period,
      branchMention: route.branchMention,
      filters: mergedFilters,
      profile: profileHint,
      branch: mergedFilters.branch,
      question,
      foodicsPeriod,
      foodicsCompare: route.foodicsCompare,
      vaultPeriod: route.vaultPeriod,
      rankingBasis: route.rankingBasis,
      topLimit: route.topLimit,
    }) as Record<string, unknown> | null;

    if (periodWarnings.length && tool) {
      tool.warnings = [...((tool.warnings as string[]) || []), ...periodWarnings];
    }
  }

  const deterministic = isVaultDataIntent(route.intent)
    ? buildVaultAnswer(route, tool, readiness)
    : buildDeterministicAskNacAnswer(route, tool, readiness);

  deterministic.intent = route.intent;
  deterministic.readiness = readiness;

  const { answer, aiConnected } = await narrateWithOpenAi(deterministic, {
    question,
    intent: route.intent,
    tool,
    diagnostics: (tool?.mtdHybrid as Record<string, unknown>) || null,
  });

  return {
    ...answer,
    intent: route.intent,
    routingConfidence: route.confidence,
    routingDebug: route.debug,
    serverConnected: true,
    aiConnected,
    localFallback: false,
  };
}
