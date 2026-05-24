/**
 * Executive export package contract — plug-in sections without rewriting PDF core.
 * @typedef {'summary'|'topItems'|'bottomItems'|'waiterSales'|'waiterUpsell'|'khobarGoogle'} ExecutiveSectionId
 */

export const EXECUTIVE_EXPORT_VERSION = 2;

export const SECTION_IDS = {
  SUMMARY: "summary",
  TOP_ITEMS: "topItems",
  BOTTOM_ITEMS: "bottomItems",
  WAITER_SALES: "waiterSales",
  WAITER_UPSELL: "waiterUpsell",
  KHOBAR_GOOGLE: "khobarGoogle",
};

/** Future sections register here; PDF iterates enabled sections. */
export const PLUGGABLE_SECTION_REGISTRY = [
  { id: SECTION_IDS.SUMMARY, kind: "briefing", defaultEnabled: true },
  { id: SECTION_IDS.TOP_ITEMS, kind: "table", defaultEnabled: true },
  { id: SECTION_IDS.BOTTOM_ITEMS, kind: "table", defaultEnabled: true },
  { id: SECTION_IDS.WAITER_SALES, kind: "table", defaultEnabled: true },
  { id: SECTION_IDS.WAITER_UPSELL, kind: "table", defaultEnabled: true },
  { id: SECTION_IDS.KHOBAR_GOOGLE, kind: "table", defaultEnabled: true },
  // Future: laborCost, foodCost, inventory, reviewTrends, branchCompare, forecast
];

export function createEmptySection({ id, title, subtitle = null }) {
  return {
    id,
    title,
    subtitle,
    rows: [],
    footer: null,
    note: null,
    coverage: null,
    insights: null,
  };
}
