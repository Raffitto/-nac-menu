/**
 * Natural-language normalization — synonym expansion before deterministic routing.
 */

const PHRASE_REPLACEMENTS = [
  [/how many reviews were (?:done|posted|received|written)/gi, "how many google reviews"],
  [/how many reviews\b/gi, "how many google reviews"],
  [/number of reviews\b/gi, "google review count"],
  [/review count\b/gi, "google review count"],
  [/google review count\b/gi, "google review count"],
  [/reviews this month\b/gi, "google reviews this month"],
  [/reviews last month\b/gi, "google reviews last month"],
  [/reviews in\b/gi, "google reviews in"],
  [/^\s*reviews\s*$/gi, "google reviews this month"],
  [/best[\s-]?selling\b/gi, "top selling items"],
  [/best seller(s)?\b/gi, "top items"],
  [/most popular item(s)?\b/gi, "top items"],
  [/most popular\b/gi, "top items"],
  [/which item sells most\b/gi, "top items by quantity"],
  [/what sells most\b/gi, "top items by quantity"],
  [/top seller\b/gi, "top item"],
  [/waiter performance\b/gi, "waiter google redirect leaderboard"],
  [/staff performance\b/gi, "staff google redirect leaderboard"],
  [/which waiter performs best\b/gi, "which waiter drove most google redirects"],
  [/which staff performs best\b/gi, "which staff drove most google redirects"],
  [/best waiter\b/gi, "top waiter google redirects"],
  [/best performing waiter\b/gi, "top waiter google redirects"],
  [/did ([\w\s]+?) improve\b/gi, "$1 branch improved"],
  [/branch performance\b/gi, "branch performing best overall"],
  [/performing best overall\b/gi, "performing best overall"],
  [/total revenue\b/gi, "total sales"],
  [/how much did we sell\b/gi, "what were total sales"],
  [/how much sales\b/gi, "what were total sales"],
  [/nac restaurant\b/gi, "network"],
  [/popular dishes\b/gi, "top items"],
  [/top sellers\b/gi, "top items"],
  [/best item\b/gi, "top items"],
  [/who is the top waiter for reviews\b/gi, "which waiter drove most google redirects"],
  [/item that sells the most\b/gi, "top items by quantity"],
  [/winning on redirects\b/gi, "who drove most google redirects"],
  [/staff redirect ranking\b/gi, "staff google redirect leaderboard"],
  [/item rank changes\b/gi, "which item entered the top 10"],
  [/google maps performance\b/gi, "google maps branch performance"],
  [/branch revenue comparison\b/gi, "branch sales by branch"],
  [/top category\b/gi, "which category generated the most revenue"],
  [/summarize uploaded files\b/gi, "which uploaded files cover"],
];

const METRIC_HINTS = {
  reviews: /\b(review|reviews|google review|star rating)\b/i,
  sales: /\b(sales|revenue|sold|foodics)\b/i,
  topItems: /\b(top item|top selling|best sell|sells most|most popular|best seller)\b/i,
  staff: /\b(waiter|waitress|server|staff|employee)\b/i,
  branch: /\b(branch|location|khobar|riyadh|jeddah|network)\b/i,
  improve: /\b(improve|improved|improvement|momentum|gaining)\b/i,
  redirects: /\b(redirect|redirects)\b/i,
};

export function detectMetricHints(text = "") {
  const q = String(text || "");
  return {
    reviews: METRIC_HINTS.reviews.test(q) && !METRIC_HINTS.redirects.test(q),
    sales: METRIC_HINTS.sales.test(q) && !METRIC_HINTS.topItems.test(q),
    topItems: METRIC_HINTS.topItems.test(q),
    staff: METRIC_HINTS.staff.test(q),
    branch: METRIC_HINTS.branch.test(q),
    improve: METRIC_HINTS.improve.test(q),
    redirects: METRIC_HINTS.redirects.test(q),
    quantityRanking: /\b(by quantity|quantity|units sold|sells most|top selling)\b/i.test(q),
  };
}

/**
 * @returns {{ original: string, text: string, hints: object, appliedRules: string[] }}
 */
export function normalizeAskNacQuestion(question = "") {
  const original = String(question || "").trim();
  let text = original;
  const appliedRules = [];

  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement);
      appliedRules.push(String(pattern));
    }
  }

  return {
    original,
    text: text.trim().replace(/\s+/g, " "),
    hints: detectMetricHints(text),
    appliedRules,
  };
}
