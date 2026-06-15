/**
 * Read-only Ask NAC query tools — Supabase RPC / existing APIs only.
 */

import { fetchUnifiedReviewTruth } from "../../lib/unifiedReviewTruth";
import { fetchBranchComparisonSafe } from "../../lib/intelligenceQueryApi";
import { resolveRbacQueryBranch } from "../../lib/rbacQueryScope";
import { periodLabelFromHours } from "../../dashboard/utils/businessDay";
import { branchDisplayName } from "../../dashboard/utils/rangeState";
import { ASK_NAC_INTENTS, isVaultDataIntent, isVaultDocumentIntent } from "./intentRouter";
import { queryOperationalKnowledge } from "./vault/knowledgeQueryTools";
import { runVaultQueryTool } from "./vault/vaultQueryTools";
import { queryExecutiveAnalysis } from "./executive/executiveQueryTools";
import { queryGoogleReviewCount } from "./googleReviews/googleReviewQueryTools";
import { fetchAskNacMenuMetrics } from "./shared/askNacMenuMetrics";
import {
  compareFoodicsTopItems,
  getFoodicsBranchSalesComparison,
  getFoodicsCategorySales,
  getFoodicsSalesSummary,
  getFoodicsTopItems,
} from "./foodics/foodicsQueryTools";

export const MAX_STAFF_LEADERBOARD_ROWS = 10;
export const MAX_BRANCH_COMPARISON_ROWS = 12;

function resolveBranch(context) {
  const fromQuestion = context.branchMention;
  const fromFilters = context.filters?.branch;
  const scoped = resolveRbacQueryBranch(context.profile, fromQuestion || fromFilters);
  return scoped;
}

/** Menu QR scans + sessions — shared fetchAskNacMenuMetrics (Phase D hybrid MTD). */
export async function queryMenuMetrics(supabase, context = {}) {
  const hours = context.hours ?? 24;
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
    sources: [
      { name: "fetchAskNacMenuMetrics", detail: metrics.rpc || metrics.dataSource || "live/rollup/hybrid" },
    ],
  };
}

/** Review QR + Google redirects from unified review truth. */
export async function queryReviewMetrics(supabase, context = {}) {
  const hours = context.hours ?? 24;
  const branch = resolveBranch(context);

  const truth = await fetchUnifiedReviewTruth(supabase, {
    hours,
    profile: context.profile,
    branch,
  });

  const kpis = truth?.kpis || {};

  return {
    hours,
    branch: truth?.scope?.queryBranch || branch,
    branchLabel: truth?.scope?.label || (branch ? branchDisplayName(branch) : "Network"),
    periodLabel: periodLabelFromHours(hours),
    reviewQrScans: Number(kpis.qr_scans) || 0,
    googleRedirects: Number(kpis.google_redirects) || 0,
    reviewPageOpens: Number(kpis.review_page_opens) || 0,
    partial: Boolean(truth?.partial),
    note: truth?.note || null,
    staffMerged: truth?.staffMerged || [],
    branchComparison: truth?.branchComparison || [],
    sources: [{ name: "fetchUnifiedReviewTruth", detail: "get_review_events_summary" }],
    warnings: truth?.integrity?.warnings || [],
  };
}

/** Staff redirect leaderboard from review staff merge. */
export async function queryStaffRedirectLeaderboard(supabase, context = {}) {
  const review = await queryReviewMetrics(supabase, context);
  const rows = (review.staffMerged || [])
    .map((s) => ({
      name: s.name,
      role: s.role || "",
      branch: s.branch,
      googleRedirects: Number(s.google) || 0,
      reviewQrScans: Number(s.scans) || 0,
      reviewOpens: Number(s.review_opens) || 0,
    }))
    .filter((r) => r.googleRedirects > 0 || r.reviewQrScans > 0)
    .sort((a, b) => b.googleRedirects - a.googleRedirects || b.reviewQrScans - a.reviewQrScans)
    .slice(0, MAX_STAFF_LEADERBOARD_ROWS);

  return {
    ...review,
    leaderboard: rows,
    sources: [
      ...(review.sources || []),
      { name: "staffMerged", detail: "review_events staff attribution" },
    ],
  };
}

/** Cross-branch comparison via RPC. */
export async function queryBranchComparison(supabase, context = {}) {
  const hours = context.hours ?? 24;
  const res = await fetchBranchComparisonSafe(supabase, hours);
  const menuRows = Array.isArray(res?.data) ? res.data : [];

  const review = await queryReviewMetrics(supabase, { ...context, branch: null });
  const reviewByBranch = new Map(
    (review.branchComparison || []).map((r) => [String(r.branch_id), r]),
  );

  const merged = menuRows
    .map((row) => {
      const id = row.branch_id;
      const rev = reviewByBranch.get(String(id)) || {};
      return {
        branch_id: id,
        branchLabel: branchDisplayName(id),
        menuSessions: Number(row.sessions) || 0,
        menuImpressions: Number(row.impressions) || 0,
        menuOpens: Number(row.opens) || 0,
        reviewQrScans: Number(rev.qr_scans) || 0,
        googleRedirects: Number(rev.google_redirects) || 0,
      };
    })
    .sort((a, b) => b.menuSessions - a.menuSessions)
    .slice(0, MAX_BRANCH_COMPARISON_ROWS);

  return {
    hours,
    periodLabel: periodLabelFromHours(hours),
    rows: merged,
    partial: Boolean(res?.partial),
    note: res?.note || null,
    sources: [
      { name: "fetchBranchComparisonSafe", detail: "get_branch_comparison_from_rollup" },
      { name: "fetchUnifiedReviewTruth", detail: "review by_branch slice" },
    ],
    warnings: [],
  };
}

/**
 * Dispatch read-only tool for intent.
 * @returns {Promise<object|null>}
 */
export async function runAskNacQueryTool(supabase, intent, context = {}) {
  if (!supabase) return null;

  if (isVaultDataIntent(intent) || isVaultDocumentIntent(intent)) {
    return runVaultQueryTool(supabase, intent, {
      ...context,
      vaultPeriod: context.vaultPeriod,
      searchTerms: context.searchTerms || context.readiness?.searchTerms,
    });
  }

  switch (intent) {
    case ASK_NAC_INTENTS.MENU_QR_SCANS:
    case ASK_NAC_INTENTS.MENU_SESSIONS:
      return queryMenuMetrics(supabase, context);
    case ASK_NAC_INTENTS.GOOGLE_REDIRECTS:
    case ASK_NAC_INTENTS.REVIEW_QR_SCANS:
      return queryReviewMetrics(supabase, context);
    case ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD:
      return queryStaffRedirectLeaderboard(supabase, context);
    case ASK_NAC_INTENTS.BRANCH_COMPARISON:
      return queryBranchComparison(supabase, context);
    case ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS:
      return queryExecutiveAnalysis(supabase, {
        ...context,
        executiveKind: context.executiveKind || context.route?.executiveKind,
      });
    case ASK_NAC_INTENTS.OPERATIONAL_KNOWLEDGE:
      return queryOperationalKnowledge(supabase, context);
    case ASK_NAC_INTENTS.GOOGLE_REVIEWS:
      return queryGoogleReviewCount(supabase, context);
    case ASK_NAC_INTENTS.SALES_TOTAL:
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
