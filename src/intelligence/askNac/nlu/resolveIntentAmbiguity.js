/**
 * Intent ambiguity resolution — prefer likely meaning; clarify only when genuinely tied.
 */

const I = {
  UNKNOWN: "unknown",
  GOOGLE_REVIEWS: "google_reviews",
  REVIEW_QR_SCANS: "review_qr_scans",
  STAFF_REDIRECT_LEADERBOARD: "staff_redirect_leaderboard",
  EXECUTIVE_ANALYSIS: "executive_analysis",
  TOP_ITEMS: "top_items",
  SALES_TOTAL: "sales_total",
  BRANCH_COMPARISON: "branch_comparison",
  MENU_SESSIONS: "menu_sessions",
  MENU_QR_SCANS: "menu_qr_scans",
};

const MIN_SCORE = 8;
const DOMINANCE_RATIO = 0.7;
const SCORE_GAP = 3;

function scoreToConfidence(score) {
  if (score >= 12) return "high";
  if (score >= MIN_SCORE) return "medium";
  if (score > 0) return "low";
  return "none";
}

function tieBreakIntent(top, second, q, hints) {
  const pair = new Set([top.id, second.id]);

  if (pair.has(I.GOOGLE_REVIEWS) && pair.has(I.REVIEW_QR_SCANS)) {
    return hints.redirects
      ? { id: I.REVIEW_QR_SCANS, score: second.score, reason: "redirect_signal" }
      : { id: I.GOOGLE_REVIEWS, score: top.score, reason: "review_count_default" };
  }

  if (pair.has(I.STAFF_REDIRECT_LEADERBOARD) && pair.has(I.EXECUTIVE_ANALYSIS)) {
    return hints.staff
      ? { id: I.STAFF_REDIRECT_LEADERBOARD, score: top.score, reason: "staff_context" }
      : { id: I.EXECUTIVE_ANALYSIS, score: top.score, reason: "branch_context" };
  }

  if (pair.has(I.TOP_ITEMS) && pair.has(I.SALES_TOTAL)) {
    return hints.topItems
      ? { id: I.TOP_ITEMS, score: top.score, reason: "ranking_context" }
      : { id: I.SALES_TOTAL, score: second.score, reason: "total_sales_context" };
  }

  if (pair.has(I.BRANCH_COMPARISON) && pair.has(I.EXECUTIVE_ANALYSIS)) {
    return hints.improve || /\bperform(ing)? best\b/.test(q)
      ? { id: I.EXECUTIVE_ANALYSIS, score: top.score, reason: "executive_context" }
      : { id: I.BRANCH_COMPARISON, score: second.score, reason: "comparison_context" };
  }

  return null;
}

export function inferFallbackIntent(q, hints = {}) {
  const text = String(q || "").toLowerCase();
  if (!text) return null;

  if (hints.reviews && !hints.redirects) {
    return { id: I.GOOGLE_REVIEWS, score: 9 };
  }
  if (hints.topItems || /\b(best sell|sells most|most popular)\b/.test(text)) {
    return { id: I.TOP_ITEMS, score: 9 };
  }
  if (hints.sales || /\b(revenue|how much)\b/.test(text)) {
    return { id: I.SALES_TOTAL, score: 9 };
  }
  if (hints.staff && (/\b(best|top|perform)\b/.test(text) || hints.redirects)) {
    return { id: I.STAFF_REDIRECT_LEADERBOARD, score: 9 };
  }
  if (hints.improve || /\bdid\b.*\bimprove\b/.test(text)) {
    return { id: I.EXECUTIVE_ANALYSIS, score: 9 };
  }
  if (/\b(session|sessions)\b/.test(text) && !/\breview\b/.test(text)) {
    return { id: I.MENU_SESSIONS, score: 6 };
  }
  if (/\b(qr|scan|scans)\b/.test(text) && !/\breview\b/.test(text)) {
    return { id: I.MENU_QR_SCANS, score: 6 };
  }

  return null;
}

/**
 * @returns {{ intent: string, score: number, confidence: string, ambiguity?: object }}
 */
export function resolveIntentFromScores(scored = [], q = "", hints = {}) {
  const sorted = [...scored].filter((row) => row.score > 0).sort((a, b) => b.score - a.score);

  if (!sorted.length) {
    const fallback = inferFallbackIntent(q, hints);
    if (fallback) {
      return {
        intent: fallback.id,
        score: fallback.score,
        confidence: scoreToConfidence(fallback.score),
        ambiguity: { resolvedBy: "metric_default_fallback" },
      };
    }
    return { intent: I.UNKNOWN, score: 0, confidence: "none" };
  }

  const top = sorted[0];
  const second = sorted[1];

  if (top.score < MIN_SCORE) {
    const fallback = inferFallbackIntent(q, hints);
    if (fallback && fallback.score >= top.score) {
      return {
        intent: fallback.id,
        score: fallback.score,
        confidence: scoreToConfidence(fallback.score),
        ambiguity: { resolvedBy: "metric_default_fallback" },
      };
    }
  }

  if (top.score >= MIN_SCORE && (!second || top.score - second.score >= SCORE_GAP)) {
    return { intent: top.id, score: top.score, confidence: scoreToConfidence(top.score) };
  }

  if (top.score >= MIN_SCORE && second) {
    const ratio = top.score / (top.score + second.score);
    if (ratio >= DOMINANCE_RATIO) {
      return {
        intent: top.id,
        score: top.score,
        confidence: scoreToConfidence(top.score),
        ambiguity: { dominanceRatio: ratio, runnerUp: second.id },
      };
    }

    const tieBreak = tieBreakIntent(top, second, q, hints);
    if (tieBreak) {
      return {
        intent: tieBreak.id,
        score: tieBreak.score,
        confidence: "medium",
        ambiguity: { resolvedBy: tieBreak.reason, candidates: [top.id, second.id] },
      };
    }

    return {
      intent: top.id,
      score: top.score,
      confidence: "low",
      ambiguity: { nearTie: true, candidates: sorted.slice(0, 2).map((row) => row.id) },
    };
  }

  const fallback = inferFallbackIntent(q, hints);
  if (fallback) {
    return {
      intent: fallback.id,
      score: fallback.score,
      confidence: scoreToConfidence(fallback.score),
      ambiguity: { resolvedBy: "metric_default_fallback" },
    };
  }

  return { intent: I.UNKNOWN, score: 0, confidence: "none" };
}
