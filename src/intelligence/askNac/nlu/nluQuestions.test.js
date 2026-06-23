/**
 * 100+ natural-language Ask NAC routing cases — restaurant manager phrasing.
 */

import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { prepareAskNacQuestion } from "../conversation/prepareAskNacQuestion";

const I = ASK_NAC_INTENTS;

const NLU_CASES = [
  // Google review counts
  { q: "How many reviews was done last month", intent: I.GOOGLE_REVIEWS },
  { q: "Reviews this month", intent: I.GOOGLE_REVIEWS },
  { q: "How many google reviews in May", intent: I.GOOGLE_REVIEWS },
  { q: "Review count last month", intent: I.GOOGLE_REVIEWS },
  { q: "Number of reviews this month", intent: I.GOOGLE_REVIEWS },
  { q: "How many reviews did we get", intent: I.GOOGLE_REVIEWS },
  { q: "Google reviews for Khobar last month", intent: I.GOOGLE_REVIEWS },
  { q: "Reviews in June", intent: I.GOOGLE_REVIEWS },
  { q: "What are our google reviews this month", intent: I.GOOGLE_REVIEWS },
  { q: "Published reviews last month", intent: I.GOOGLE_REVIEWS },

  // Top items / best selling
  { q: "What is the best selling in the NAC restaurant", intent: I.TOP_ITEMS },
  { q: "Which item sells most", intent: I.TOP_ITEMS, rankingBasis: "quantity" },
  { q: "Best seller last month", intent: I.TOP_ITEMS },
  { q: "Most popular item", intent: I.TOP_ITEMS },
  { q: "Top selling items in May", intent: I.TOP_ITEMS },
  { q: "What sells most at Khobar", intent: I.TOP_ITEMS },
  { q: "Best selling dish", intent: I.TOP_ITEMS },
  { q: "Which item is most popular", intent: I.TOP_ITEMS },
  { q: "Top items by quantity", intent: I.TOP_ITEMS, rankingBasis: "quantity" },
  { q: "What were the top 10 items last month", intent: I.TOP_ITEMS, topLimit: 10 },

  // Sales totals
  { q: "What were sales in May", intent: I.SALES_TOTAL },
  { q: "Total sales last month", intent: I.SALES_TOTAL },
  { q: "How much did we sell in June", intent: I.SALES_TOTAL },
  { q: "Revenue this month", intent: I.SALES_TOTAL },
  { q: "What were total sales for Khobar in May", intent: I.SALES_TOTAL },
  { q: "Sales for Riyadh last month", intent: I.SALES_TOTAL },
  { q: "How much sales in May", intent: I.SALES_TOTAL },
  { q: "Foodics sales this month", intent: I.SALES_TOTAL },
  { q: "What were net sales last month", intent: I.SALES_TOTAL },
  { q: "Total revenue in June", intent: I.SALES_TOTAL },

  // Staff / waiter performance
  { q: "Which waiter performs best", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Best waiter this month", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Who drove the most Google redirects", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Top staff for redirects", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Staff leaderboard last month", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Which employee drove most google redirects", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Best performing waiter", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Waiter performance this month", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Who is the top waiter for reviews", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Which server drove the most redirects", intent: I.STAFF_REDIRECT_LEADERBOARD },

  // Branch improvement / executive
  { q: "Did Khobar improve", intent: I.EXECUTIVE_ANALYSIS, executiveKind: "improved_most" },
  { q: "Did Riyadh improve last month", intent: I.EXECUTIVE_ANALYSIS },
  { q: "Which branch improved the most", intent: I.EXECUTIVE_ANALYSIS },
  { q: "Which branch is performing best overall", intent: I.EXECUTIVE_ANALYSIS, executiveKind: "best_overall" },
  { q: "Which location is winning on Google Maps", intent: I.EXECUTIVE_ANALYSIS },
  { q: "What should management focus on this week", intent: I.EXECUTIVE_ANALYSIS },
  { q: "Which branch needs attention", intent: I.EXECUTIVE_ANALYSIS },
  { q: "Branch performance this month", intent: I.EXECUTIVE_ANALYSIS },
  { q: "Compare all branches", intent: I.EXECUTIVE_ANALYSIS },
  { q: "How many stars gained since follow-up", intent: I.EXECUTIVE_ANALYSIS, executiveKind: "stars_gained" },

  // Menu / redirects (should NOT map reviews to QR)
  { q: "How many menu QR scans today", intent: I.MENU_QR_SCANS },
  { q: "Menu sessions this month", intent: I.MENU_SESSIONS },
  { q: "Google redirects this month", intent: I.GOOGLE_REDIRECTS },
  { q: "How many google redirects yesterday", intent: I.GOOGLE_REDIRECTS },
  { q: "Review QR scans today", intent: I.REVIEW_QR_SCANS },
  { q: "Compare branches this month", intent: I.BRANCH_COMPARISON },
  { q: "Khobar vs Riyadh menu sessions", intent: I.BRANCH_COMPARISON },

  // Categories
  { q: "Which category generated the most revenue", intent: I.CATEGORY_SALES },
  { q: "Category sales in May", intent: I.CATEGORY_SALES },
  { q: "Top category last month", intent: I.CATEGORY_SALES },

  // Rank changes
  { q: "Which item entered the top 10 compared to last month", intent: I.ITEM_RANK_CHANGE },
  { q: "Compare top items May vs April", intent: I.TOP_ITEMS_COMPARE },

  // Vault
  { q: "What happened in Khobar on 5 June", intent: I.VAULT_OPERATIONAL_DAY_SUMMARY },
  { q: "Summarize uploaded files for June", intent: I.VAULT_COVERAGE_LIST },

  // Operational knowledge
  { q: "Why did sales drop", intent: I.VAULT_BUSINESS_REASONING },
  { q: "What operational issues repeated", intent: I.VAULT_OPERATIONAL_REVIEW },
  { q: "Summarize latest Khobar logbook", intent: I.VAULT_DOCUMENT_SUMMARY },
  { q: "What maintenance issues repeat?", intent: I.VAULT_OPERATIONAL_REVIEW },
  { q: "Staff concerns in uploaded reports", intent: I.VAULT_OPERATIONAL_REVIEW },
  { q: "SOP violations", intent: I.VAULT_OPERATIONAL_REVIEW },
  { q: "Operational issues during June", intent: I.VAULT_OPERATIONAL_REVIEW },
  { q: "What happened in June logbooks?", intent: I.VAULT_OPERATIONAL_REVIEW },
  { q: "Summarize uploaded reports", intent: I.VAULT_DOCUMENT_SUMMARY },

  // More natural manager phrasing (bulk)
  { q: "give me sales for last month", intent: I.SALES_TOTAL },
  { q: "show me top sellers", intent: I.TOP_ITEMS },
  { q: "who is winning on redirects", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "reviews for riyadh", intent: I.GOOGLE_REVIEWS },
  { q: "how are we doing on google reviews", intent: I.GOOGLE_REVIEWS },
  { q: "best item in jeddah", intent: I.TOP_ITEMS },
  { q: "most sold item may", intent: I.TOP_ITEMS },
  { q: "sales riyadh may", intent: I.SALES_TOTAL },
  { q: "did jeddah improve", intent: I.EXECUTIVE_ANALYSIS },
  { q: "improvement at khobar", intent: I.EXECUTIVE_ANALYSIS },
  { q: "top waiter last week", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "Sales today", intent: I.SALES_TOTAL },
  { q: "Google reviews this week", intent: I.GOOGLE_REVIEWS },
  { q: "QR scans today", intent: I.MENU_QR_SCANS },
  { q: "Top selling items", intent: I.TOP_ITEMS },
  { q: "menu scans today", intent: I.MENU_QR_SCANS },
  { q: "sessions this week", intent: I.MENU_SESSIONS },
  { q: "branch sales comparison may", intent: I.BRANCH_SALES },
  { q: "which branch sold most", intent: I.BRANCH_SALES },
  { q: "item rank changes", intent: I.ITEM_RANK_CHANGE },
  { q: "top ten items june", intent: I.TOP_ITEMS, topLimit: 10 },
  { q: "quantity ranking for items", intent: I.TOP_ITEMS, rankingBasis: "quantity" },
  { q: "google review count khobar", intent: I.GOOGLE_REVIEWS },
  { q: "how many reviews khobar last month", intent: I.GOOGLE_REVIEWS },
  { q: "performing best branch", intent: I.EXECUTIVE_ANALYSIS },
  { q: "weakest branch", intent: I.EXECUTIVE_ANALYSIS },
  { q: "management focus this week", intent: I.EXECUTIVE_ANALYSIS },
  { q: "stars gained this month", intent: I.EXECUTIVE_ANALYSIS },
  { q: "what changed since last month", intent: I.EXECUTIVE_ANALYSIS },
  { q: "linked reports same problem", intent: I.OPERATIONAL_KNOWLEDGE },
  { q: "which reports mention complaints", intent: I.OPERATIONAL_KNOWLEDGE },
  { q: "cash up summary 5 june khobar", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "show latest cash up", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "latest cash-up report", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "summarize latest cash up report", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "net sales from cash up", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "cash sales yesterday", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "card sales yesterday", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "delivery sales yesterday", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "compare cash up vs foodics", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "reception covers 5 june", intent: I.VAULT_RECEPTION_SUMMARY },
  { q: "logbook complaints 5 june", intent: I.VAULT_LOGBOOK_SUMMARY },
  { q: "summarize daily briefing this month", intent: I.VAULT_DAILY_BRIEFING_SUMMARY },
  { q: "show breakage issues this month", intent: I.VAULT_BREAKAGE_SUMMARY },
  { q: "ccm reconciliation june", intent: I.VAULT_CCM_RECONCILIATION_SUMMARY },
  { q: "five star google reviews 5 june", intent: I.VAULT_GOOGLE_REVIEW_STAR_SUMMARY },
  { q: "generate management report for june", intent: I.VAULT_MANAGEMENT_REPORT },
  { q: "what data do we have for june", intent: I.VAULT_COVERAGE_LIST },
  { q: "health check", intent: I.VAULT_KNOWLEDGE_HEALTH },
  { q: "knowledge health", intent: I.VAULT_KNOWLEDGE_HEALTH },
  { q: "what am I missing", intent: I.VAULT_KNOWLEDGE_HEALTH },
  { q: "dashboard readiness", intent: I.VAULT_KNOWLEDGE_HEALTH },
  { q: "why is confidence low", intent: I.VAULT_KNOWLEDGE_HEALTH },
  { q: "average spend per guest", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "delivery sales hungerstation", intent: I.VAULT_CASH_UP_SUMMARY },
  { q: "foodics data", intent: I.FOODICS_QUERY },
  { q: "how many redirects did staff drive", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "best seller by quantity", intent: I.TOP_ITEMS, rankingBasis: "quantity" },
  { q: "popular dishes last month", intent: I.TOP_ITEMS },
  { q: "review growth this month", intent: I.GOOGLE_REVIEWS },
  { q: "google maps performance", intent: I.EXECUTIVE_ANALYSIS },
  { q: "network health", intent: I.EXECUTIVE_ANALYSIS },
  { q: "operational score branches", intent: I.EXECUTIVE_ANALYSIS },
  { q: "what happened operationally on 5 june", intent: I.VAULT_OPERATIONAL_DAY_SUMMARY },
  { q: "summarize branch operation 5 june", intent: I.VAULT_OPERATIONAL_DAY_SUMMARY },
  { q: "compare top items last two months", intent: I.TOP_ITEMS_COMPARE },
  { q: "rank items by quantity instead of sales", intent: I.TOP_ITEMS, rankingBasis: "quantity" },
  { q: "total sales khobar may 2026", intent: I.SALES_TOTAL },
  { q: "top items riyadh last month", intent: I.TOP_ITEMS },
  { q: "reviews this month khobar", intent: I.GOOGLE_REVIEWS },
  { q: "who is best waiter for google", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "did riyadh improve on google maps", intent: I.EXECUTIVE_ANALYSIS },
  { q: "most improvement branch", intent: I.EXECUTIVE_ANALYSIS },
  { q: "what were the best sellers in may", intent: I.TOP_ITEMS },
  { q: "how much revenue last month", intent: I.SALES_TOTAL },
  { q: "item that sells the most", intent: I.TOP_ITEMS },
  { q: "restaurant best selling product", intent: I.TOP_ITEMS },
  { q: "nac top item", intent: I.TOP_ITEMS },
  { q: "review count network", intent: I.GOOGLE_REVIEWS },
  { q: "google reviews network this month", intent: I.GOOGLE_REVIEWS },
  { q: "staff redirect ranking", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "waiter redirect leaderboard", intent: I.STAFF_REDIRECT_LEADERBOARD },
  { q: "compare branches on menu sessions", intent: I.BRANCH_COMPARISON },
  { q: "cross branch comparison", intent: I.BRANCH_COMPARISON },
  { q: "category revenue may", intent: I.CATEGORY_SALES },
  { q: "which category sold most", intent: I.CATEGORY_SALES },
  { q: "sales by branch may", intent: I.BRANCH_SALES },
  { q: "branch revenue comparison", intent: I.BRANCH_SALES },
  { q: "why did sales drop in june", intent: I.VAULT_BUSINESS_REASONING },
  { q: "what changed between may and june", intent: I.OPERATIONAL_KNOWLEDGE },
  { q: "same problem across reports", intent: I.OPERATIONAL_KNOWLEDGE },
];

describe("NLU natural language routing", () => {
  test.each(NLU_CASES.map((row, index) => [index + 1, row.q, row]))(
    "case #%i: %s",
    (_index, _question, row) => {
      const route = routeAskNacIntent(row.q, { fallbackHours: 720 });
      expect(route.intent).toBe(row.intent);
      expect(route.intent).not.toBe(I.UNKNOWN);
      if (row.rankingBasis) expect(route.rankingBasis).toBe(row.rankingBasis);
      if (row.topLimit) expect(route.topLimit).toBe(row.topLimit);
      if (row.executiveKind) expect(route.executiveKind).toBe(row.executiveKind);
    },
  );

  test("never returns unknown for canonical manager examples", () => {
    const examples = [
      "How many reviews was done last month",
      "What is the best selling in the NAC restaurant",
      "Which item sells most",
      "Reviews this month",
      "Which waiter performs best",
      "Did Khobar improve",
    ];
    for (const q of examples) {
      const route = routeAskNacIntent(q, { fallbackHours: 720 });
      expect(route.intent).not.toBe(I.UNKNOWN);
    }
  });
});

describe("NLU conversational follow-ups", () => {
  test("What about last month inherits prior question period", () => {
    const result = prepareAskNacQuestion({
      question: "What about last month?",
      conversationContext: {
        lastResolvedQuestion: "How many google redirects?",
        lastIntent: I.GOOGLE_REDIRECTS,
      },
    });
    expect(result.effectiveQuestion.toLowerCase()).toMatch(/last month/);
    expect(result.conversationResolution.usedContext).toBe(true);
  });

  test("What about Khobar inherits branch", () => {
    const result = prepareAskNacQuestion({
      question: "What about Khobar?",
      conversationContext: {
        lastResolvedQuestion: "What were sales in May?",
        lastIntent: I.SALES_TOTAL,
      },
    });
    expect(result.effectiveQuestion.toLowerCase()).toMatch(/khobar/);
  });

  test("What about reviews maps to google reviews follow-up", () => {
    const result = prepareAskNacQuestion({
      question: "What about reviews?",
      conversationContext: {
        lastResolvedQuestion: "What were sales in May?",
        lastIntent: I.SALES_TOTAL,
      },
    });
    expect(result.effectiveQuestion.toLowerCase()).toMatch(/google reviews/);
  });
});
