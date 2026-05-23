/**
 * Operational validation checklist — compare floor observations vs dashboard metrics.
 */

export const VALIDATION_OBSERVATION_KEY = "nac_validation_observations_v1";

/** @typedef {{ id: string, label: string, dashboardPath: string, observationKey: string, tolerancePct: number, hint: string }} ValidationChecklistItem */

/** @type {ValidationChecklistItem[]} */
export const VALIDATION_CHECKLIST_ITEMS = [
  {
    id: "qr_window",
    label: "QR / menu sessions (30 min floor count)",
    dashboardPath: "funnel.qr_scans",
    observationKey: "qr_scans_30min",
    tolerancePct: 45,
    hint: "Count distinct guests scanning the menu QR in a 30-minute window; compare to dashboard QR sessions for Today.",
  },
  {
    id: "category_nav",
    label: "Category navigation (tabs / pills)",
    dashboardPath: "funnel.category_opens",
    observationKey: "category_nav_count",
    tolerancePct: 50,
    hint: "Count category tab or pill taps observed; compare to category opens in funnel.",
  },
  {
    id: "item_interest",
    label: "Item modal opens (sample)",
    dashboardPath: "funnel.item_opens",
    observationKey: "item_opens_observed",
    tolerancePct: 55,
    hint: "Count item detail opens during service; compare to item opens in funnel.",
  },
  {
    id: "top_dish",
    label: "Most discussed dish vs top item chart",
    dashboardPath: "top_items.0.opens",
    observationKey: "top_dish_opens_observed",
    tolerancePct: 60,
    hint: "Note the busiest item on the floor; compare opens to #1 in top items (approximate).",
  },
  {
    id: "modifier_upsell",
    label: "Add-on / modifier clicks",
    dashboardPath: "funnel.addon_clicks",
    observationKey: "addon_clicks_observed",
    tolerancePct: 50,
    hint: "Count waiter upsell or guest add-on taps; compare to add-on clicks in funnel.",
  },
  {
    id: "peak_hour",
    label: "Peak rush hour vs hourly chart",
    dashboardPath: "strongest_hour",
    observationKey: "peak_hour_observed",
    tolerancePct: 0,
    hint: "Record busiest hour (0–23 Riyadh); must match strongest hour or within 1 hour.",
  },
];
