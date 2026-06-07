/**
 * Ask NAC NLU — synonym normalization and ambiguity resolution (Edge).
 */

const PHRASE_REPLACEMENTS: [RegExp, string][] = [
  [/how many reviews were (?:done|posted|received|written)/gi, "how many google reviews"],
  [/how many reviews\b/gi, "how many google reviews"],
  [/number of reviews\b/gi, "google review count"],
  [/review count\b/gi, "google review count"],
  [/reviews this month\b/gi, "google reviews this month"],
  [/reviews last month\b/gi, "google reviews last month"],
  [/reviews in\b/gi, "google reviews in"],
  [/best[\s-]?selling\b/gi, "top selling items"],
  [/best seller(s)?\b/gi, "top items"],
  [/most popular item(s)?\b/gi, "top items"],
  [/which item sells most\b/gi, "top items by quantity"],
  [/waiter performance\b/gi, "waiter google redirect leaderboard"],
  [/which waiter performs best\b/gi, "which waiter drove most google redirects"],
  [/did ([\w\s]+?) improve\b/gi, "$1 branch improved"],
  [/top sellers\b/gi, "top items"],
  [/best item\b/gi, "top items"],
  [/who is the top waiter for reviews\b/gi, "which waiter drove most google redirects"],
];

export function normalizeAskNacQuestionEdge(question = "") {
  const original = String(question || "").trim();
  let text = original;
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    if (pattern.test(text)) text = text.replace(pattern, replacement);
  }
  const hints = {
    reviews: /\b(review|reviews|google review)\b/i.test(text) && !/\bredirect/i.test(text),
    sales: /\b(sales|revenue)\b/i.test(text),
    topItems: /\b(top item|top selling|best sell|sells most|most popular)\b/i.test(text),
    staff: /\b(waiter|waitress|server|staff|employee)\b/i.test(text),
    improve: /\b(improve|improved|improvement)\b/i.test(text),
    redirects: /\bredirect/i.test(text),
    quantityRanking: /\b(by quantity|sells most|best selling)\b/i.test(text),
  };
  return { original, text: text.trim().replace(/\s+/g, " "), hints };
}

const MIN_SCORE = 8;
const DOMINANCE_RATIO = 0.7;
const SCORE_GAP = 3;

export function resolveIntentFromScoresEdge(
  scored: { id: string; score: number }[],
  q: string,
  hints: Record<string, boolean>,
) {
  const sorted = [...scored].filter((row) => row.score > 0).sort((a, b) => b.score - a.score);
  if (!sorted.length) {
    if (hints.reviews && !hints.redirects) return { intent: "google_reviews", score: 9, confidence: "medium" };
    if (hints.topItems) return { intent: "top_items", score: 9, confidence: "medium" };
    if (hints.sales) return { intent: "sales_total", score: 9, confidence: "medium" };
    if (hints.staff) return { intent: "staff_redirect_leaderboard", score: 9, confidence: "medium" };
    return { intent: "unknown", score: 0, confidence: "none" };
  }
  const top = sorted[0];
  const second = sorted[1];
  if (top.score >= MIN_SCORE && (!second || top.score - second.score >= SCORE_GAP)) {
    return { intent: top.id, score: top.score, confidence: top.score >= 12 ? "high" : "medium" };
  }
  if (top.score >= MIN_SCORE && second) {
    const ratio = top.score / (top.score + second.score);
    if (ratio >= DOMINANCE_RATIO) {
      return { intent: top.id, score: top.score, confidence: "medium" };
    }
    if (hints.staff && top.id === "staff_redirect_leaderboard") {
      return { intent: top.id, score: top.score, confidence: "medium" };
    }
    if (hints.reviews && top.id === "google_reviews") {
      return { intent: top.id, score: top.score, confidence: "medium" };
    }
  }
  return {
    intent: top.id,
    score: top.score,
    confidence: top.score >= 12 ? "high" : top.score >= MIN_SCORE ? "medium" : "low",
  };
}
