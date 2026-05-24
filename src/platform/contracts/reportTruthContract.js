/**
 * Report truth enforcement — executive-safe thresholds (Tableau-grade integrity).
 */

export const REPORT_TRUTH = {
  conversion: {
    minViews: 10,
    minSessions: 5,
    minOrdersForRate: 1,
    minConfidenceForPct: "medium",
  },
  import: {
    netSalesToleranceSar: 0.5,
    quantityTolerance: 0,
  },
  visibility: {
    minViewsForQuadrant: 10,
    minConfidenceForQuadrant: "medium",
    highViewThreshold: 15,
    lowViewThreshold: 8,
    highSalesThreshold: 5,
  },
  offline: {
    /** sales high, views very low */
    minSalesForOffline: 8,
    maxViewsForOffline: 7,
  },
  executive: {
    /** Hide misleading KPIs when below this confidence */
    minConfidenceToShow: "medium",
  },
};

export const MODIFIER_SEMANTIC_CLASSES = new Set([
  "modifier",
  "addon",
  "add_on",
  "sauce",
  "sauce_condiment",
  "condiment",
  "drink_modifier",
  "extra",
]);

export const INSUFFICIENT_MENU_SAMPLE = "Insufficient menu sample";

export const IMPORT_MISMATCH = "Import mismatch";
