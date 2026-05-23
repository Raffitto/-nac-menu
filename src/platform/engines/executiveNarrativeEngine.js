/**
 * Executive narratives — consistent terminology, deduped insights, confidence-aware copy.
 */

import { tapToGooglePct } from "./funnelAnalyticsEngine";
import { PLATFORM_STATUS } from "../contracts/platformStatusContract";

const TERMINOLOGY = {
  cardTaps: "card taps",
  googleRedirects: "Google redirects",
  conversion: "tap-to-Google rate",
  operationalScore: "operational score",
  participation: "staff participation",
};

export function getExecutiveTerm(key) {
  return TERMINOLOGY[key] || key;
}

/** Remove duplicate or near-duplicate insight lines. */
export function dedupeExecutiveInsights(insights = []) {
  const seen = new Set();
  const out = [];

  for (const item of insights || []) {
    const text = String(item?.text || item || "").trim();
    if (!text) continue;
    const key = text
      .toLowerCase()
      .replace(/\d+/g, "#")
      .slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(typeof item === "object" ? { ...item, text } : { text, id: `ins-${out.length}` });
  }
  return out;
}

/**
 * Align KPI display with confidence — avoid showing misleading 0% when sample is tiny.
 */
export function formatExecutiveKpi(value, { confidence = "medium", type = "count" } = {}) {
  const n = Number(value) || 0;
  if (confidence === "low" && n === 0 && type === "pct") {
    return { display: "—", raw: 0, provisional: true };
  }
  if (type === "pct") {
    return { display: `${n}%`, raw: n, provisional: confidence === "low" };
  }
  return { display: String(n), raw: n, provisional: confidence === "low" && n < 5 };
}

/**
 * Single network headline from comparison rows (no duplicate branch callouts).
 */
export function buildNetworkHeadline({ branchComparison = [], branchScores = [] } = {}) {
  const rows = branchComparison || [];
  const withScans = rows.filter((r) => (r.qr_scans || 0) > 0);
  if (!withScans.length) {
    return {
      headline: "Network review activity is quiet for this period.",
      confidence: "low",
    };
  }

  const leader = [...withScans].sort(
    (a, b) => tapToGooglePct(b.google_redirects, b.qr_scans) - tapToGooglePct(a.google_redirects, a.qr_scans),
  )[0];

  const totalScans = withScans.reduce((s, r) => s + (r.qr_scans || 0), 0);
  const confidence = totalScans >= 40 ? "high" : totalScans >= 15 ? "medium" : "low";

  if (!leader) {
    return { headline: "Review activity is building across branches.", confidence };
  }

  const rate = tapToGooglePct(leader.google_redirects, leader.qr_scans);
  return {
    headline: `${leader.branch_id ? leader.branch_id.charAt(0).toUpperCase() + leader.branch_id.slice(1) : "Top branch"} leads ${getExecutiveTerm("conversion")} at ${rate}% (${leader.qr_scans} ${getExecutiveTerm("cardTaps")}).`,
    confidence,
    leaderBranchId: leader.branch_id,
  };
}

export function mergeExecutiveInsights(...groups) {
  return dedupeExecutiveInsights(groups.flat().filter(Boolean));
}

export function narrativeForPlatformStatus(status) {
  switch (status) {
    case PLATFORM_STATUS.SPARSE_HISTORY:
      return "Interpret trends cautiously until more guest sessions are recorded.";
    case PLATFORM_STATUS.BASELINE_BUILDING:
      return "Scores and comparisons will stabilize as activity accumulates.";
    case PLATFORM_STATUS.PARTIAL:
      return "Network totals are reliable; branch-level detail may be simplified.";
    default:
      return null;
  }
}
