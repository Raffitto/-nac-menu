/**
 * NAC Intelligence — canonical metric dictionary (single source of truth for labels & semantics).
 * Phase C: definitions and UI copy only. Calculation logic lives in operational/BI modules.
 */

export const METRIC_IDS = Object.freeze({
  MENU_QR_SCAN: "menu_qr_scan",
  REVIEW_QR_SCAN: "review_qr_scan",
  SESSION: "session",
  GOOGLE_REDIRECT: "google_redirect",
  GOOGLE_REVIEW: "google_review",
  STAFF_ATTRIBUTION: "staff_attribution",
  AVG_SPEND_PER_GUEST: "avg_spend_per_guest",
  DELIVERY_SALES: "delivery_sales",
  TOP_ITEM: "top_item",
  CATEGORY_PERFORMANCE: "category_performance",
  MONTH_TO_DATE: "month_to_date",
  TODAY: "today",
  PARTIAL_LIVE: "partial_live",
});

/** @typedef {'available'|'partial'|'planned'|'unavailable'} MetricAvailability */

/**
 * @typedef {object} MetricDefinition
 * @property {string} id
 * @property {string} label
 * @property {string} shortLabel
 * @property {string} description
 * @property {string} canonicalSource
 * @property {string} calculationRule
 * @property {string[]} commonMistakes
 * @property {MetricAvailability} dataAvailability
 * @property {string} warningWhenPartial
 */

/** @type {Record<string, MetricDefinition>} */
export const METRIC_DEFINITIONS = Object.freeze({
  [METRIC_IDS.MENU_QR_SCAN]: {
    id: METRIC_IDS.MENU_QR_SCAN,
    label: "Menu QR Scans",
    shortLabel: "Menu QR",
    description:
      "Guests who entered the digital menu via a menu QR code or session start — not review portal scans.",
    canonicalSource: "menu_events · event_type = qr_session_start (distinct sessions)",
    calculationRule:
      "Count distinct menu sessions with qr_session_start only. Never include review_events or review portal entry.",
    commonMistakes: [
      "Mixing review QR card taps with menu QR scans",
      "Using total_events or all session_ids with any event as menu QR",
      "Treating page loads without qr_session_start as scans",
    ],
    dataAvailability: "available",
    warningWhenPartial:
      "Menu QR counts may blend live today data with recovered rollup for longer ranges — compare ranges using the same filter set.",
  },
  [METRIC_IDS.REVIEW_QR_SCAN]: {
    id: METRIC_IDS.REVIEW_QR_SCAN,
    label: "Review QR Scans",
    shortLabel: "Review QR",
    description:
      "Guests who opened the review collection flow via review QR / NFC — separate from menu browsing.",
    canonicalSource: "review_events · review portal entry events",
    calculationRule:
      "Count review portal QR / card tap entry events only. Never count menu qr_session_start.",
    commonMistakes: [
      "Labeling review card taps as menu scans",
      "Assuming every menu guest also scanned a review QR",
    ],
    dataAvailability: "available",
    warningWhenPartial:
      "Review QR totals may reflect today-only fallback if a wider range timed out.",
  },
  [METRIC_IDS.SESSION]: {
    id: METRIC_IDS.SESSION,
    label: "Menu Sessions",
    shortLabel: "Sessions",
    description:
      "A unique guest browsing session on the digital menu, anchored to menu QR entry when available.",
    canonicalSource: "menu_events · canonical session model (qr_session_start)",
    calculationRule:
      "One session = one distinct menu browsing session. Do not confuse with raw event counts or review visits.",
    commonMistakes: [
      "Equating sessions with total menu_events rows",
      "Using menu sessions as POS guest count",
      "Counting review portal visits as menu sessions",
    ],
    dataAvailability: "available",
    warningWhenPartial:
      "Session quality tiers may reflect a live sample that does not cover the full selected range.",
  },
  [METRIC_IDS.GOOGLE_REDIRECT]: {
    id: METRIC_IDS.GOOGLE_REDIRECT,
    label: "Google Redirects",
    shortLabel: "Redirects",
    description:
      "Guest actions that send the user to Google's public review page — intent to review, not a completed review.",
    canonicalSource: "review_events · google redirect / review_redirect events",
    calculationRule:
      "Count redirect clicks to Google review URL. Never treat redirects as published Google reviews.",
    commonMistakes: [
      "Calling redirects “reviews” or “Google reviews”",
      "Using redirect count as review velocity on Google",
      "Mixing redirect funnel with menu QR funnel",
    ],
    dataAvailability: "available",
    warningWhenPartial:
      "Staff-attributed redirect totals require employee/role fields on review events for the period.",
  },
  [METRIC_IDS.GOOGLE_REVIEW]: {
    id: METRIC_IDS.GOOGLE_REVIEW,
    label: "Actual Google Reviews",
    shortLabel: "Google reviews",
    description:
      "Observed change in public Google review count from Places/snapshot data — verified off-platform signal.",
    canonicalSource: "google_review_snapshots · public review count delta",
    calculationRule:
      "Use snapshot delta or Places total review count movement. Never infer from redirects alone.",
    commonMistakes: [
      "Equating Google Redirects with new Google reviews",
      "Using review portal interactions as Google review count",
    ],
    dataAvailability: "partial",
    warningWhenPartial:
      "Actual Google review deltas require snapshot coverage for the branch and period. Redirects are shown separately.",
  },
  [METRIC_IDS.STAFF_ATTRIBUTION]: {
    id: METRIC_IDS.STAFF_ATTRIBUTION,
    label: "Staff-Attributed Redirects",
    shortLabel: "Staff attribution",
    description:
      "Review or redirect events tied to a staff slug, employee name, role, or staff QR.",
    canonicalSource: "review_events · employee_name / employee_role / staff slug",
    calculationRule:
      "Include only events with identifiable staff attribution fields. Unattributed events are excluded from staff leaderboards.",
    commonMistakes: [
      "Assigning redirects to staff without slug/employee metadata",
      "Mixing network totals with staff-filtered totals without labeling",
    ],
    dataAvailability: "available",
    warningWhenPartial:
      "Role or shift filters may hide staff rows that exist in unfiltered network totals.",
  },
  [METRIC_IDS.AVG_SPEND_PER_GUEST]: {
    id: METRIC_IDS.AVG_SPEND_PER_GUEST,
    label: "Average Spend per Guest",
    shortLabel: "Avg spend / guest",
    description: "Net sales divided by guest count from Foodics operational reports.",
    canonicalSource: "foodics_sales_items + Foodics guest-count report (planned import lane)",
    calculationRule: "Net sales ÷ guest count for the same branch and period. Never use menu sessions as guests.",
    commonMistakes: [
      "Dividing sales by menu sessions or QR scans",
      "Using order count when guest count is required",
    ],
    dataAvailability: "planned",
    warningWhenPartial:
      "Guest count import is not connected yet — average spend per guest cannot be answered accurately until Phase J.",
  },
  [METRIC_IDS.DELIVERY_SALES]: {
    id: METRIC_IDS.DELIVERY_SALES,
    label: "Delivery Platform Sales",
    shortLabel: "Delivery sales",
    description:
      "Sales attributed to delivery channels (Jahez, HungerStation, Talabat, ToYou, etc.) from Foodics.",
    canonicalSource: "Foodics delivery / channel report (planned import lane)",
    calculationRule:
      "Sum net sales where channel/platform matches delivery source. Split by platform when report columns support it.",
    commonMistakes: [
      "Including dine-in POS sales in delivery totals",
      "Guessing platform mix without import data",
    ],
    dataAvailability: "planned",
    warningWhenPartial:
      "Delivery platform breakdown requires Foodics channel imports — not available until Phase J.",
  },
  [METRIC_IDS.TOP_ITEM]: {
    id: METRIC_IDS.TOP_ITEM,
    label: "Top Items",
    shortLabel: "Top items",
    description:
      "Ranked item performance — by net sales for sales questions; by views/opens for menu behavior questions.",
    canonicalSource:
      "Sales: foodics_sales_items · Behavior: menu_events item_open / impressions",
    calculationRule:
      "Default rank = net sales descending. Quantity rank only when explicitly requested. Never rank sales using menu views alone.",
    commonMistakes: [
      "Ranking menu views as if they were sales",
      "Mixing Foodics item names with unmatched raw import rows without warning",
    ],
    dataAvailability: "partial",
    warningWhenPartial:
      "Top item charts may use menu engagement when Foodics sales import is missing for the period.",
  },
  [METRIC_IDS.CATEGORY_PERFORMANCE]: {
    id: METRIC_IDS.CATEGORY_PERFORMANCE,
    label: "Category Performance",
    shortLabel: "Categories",
    description:
      "Category revenue/quantity from Foodics for sales; category opens/views from menu_events for browsing.",
    canonicalSource:
      "Sales: Foodics category fields · Behavior: menu_events category_open / nav events",
    calculationRule:
      "Use Foodics categories for revenue questions. Use menu category opens for engagement. Do not merge without labeling.",
    commonMistakes: [
      "Using menu category opens as category revenue",
      "Including synthetic/internal category IDs in guest-facing totals",
    ],
    dataAvailability: "partial",
    warningWhenPartial:
      "Category engagement may be live while category sales require a Foodics import for the same period.",
  },
  [METRIC_IDS.MONTH_TO_DATE]: {
    id: METRIC_IDS.MONTH_TO_DATE,
    label: "Month-to-Date",
    shortLabel: "MTD",
    description:
      "Calendar month from the 1st (Asia/Riyadh) through the current business date/time.",
    canonicalSource: "nac_filter_since(999) · menu_events_daily_rollup + live today slice",
    calculationRule:
      "Lower bound = first day of current calendar month (Riyadh). Upper bound = now. MTD must include today’s window for the same metric unless filters differ.",
    commonMistakes: [
      "Comparing MTD rollup to live Today without noting source mismatch",
      "Expecting MTD < Today for the same cumulative metric",
      "Using rolling 7D window as MTD early in the month",
    ],
    dataAvailability: "available",
    warningWhenPartial:
      "Month-to-date often uses daily rollup — today’s live slice may be ahead of rollup until refresh. Interpret MTD vs Today carefully.",
  },
  [METRIC_IDS.TODAY]: {
    id: METRIC_IDS.TODAY,
    label: "Today",
    shortLabel: "Today",
    description:
      "Current NAC business day (03:00 – 02:59 Asia/Riyadh), not naive calendar midnight UTC.",
    canonicalSource: "nac_business_day_start/end · get_bi_dashboard p_hours=24",
    calculationRule:
      "Filter events from business day start through now. Label as Today in UI; do not use UTC midnight.",
    commonMistakes: [
      "Using UTC calendar day for Saudi operations",
      "Comparing Today live counts to MTD rollup without source note",
    ],
    dataAvailability: "available",
    warningWhenPartial:
      "Today uses live menu_events — longer ranges may use rollup until merged.",
  },
  [METRIC_IDS.PARTIAL_LIVE]: {
    id: METRIC_IDS.PARTIAL_LIVE,
    label: "Partial Live Data",
    shortLabel: "Partial",
    description:
      "Some tiles use recovered rollup, live fallback, or incomplete sample while the selected range is still syncing.",
    canonicalSource: "operationalTrust · partial_mode · liveFallback flags from BI pipeline",
    calculationRule:
      "Surface whenever partial_mode, liveFallback, or rollup recovery is active. Never present partial totals as fully verified.",
    commonMistakes: [
      "Hiding rollup recovery behind rounded numbers",
      "Showing session quality sample as full-period coverage",
    ],
    dataAvailability: "available",
    warningWhenPartial:
      "Numbers may update when rollup refresh completes (~03:15 Asia/Riyadh) or when live recompute finishes.",
  },
});

const ALIASES = Object.freeze({
  menu_qr: METRIC_IDS.MENU_QR_SCAN,
  menu_qr_scans: METRIC_IDS.MENU_QR_SCAN,
  qr_scans: METRIC_IDS.MENU_QR_SCAN,
  review_qr: METRIC_IDS.REVIEW_QR_SCAN,
  review_qr_scans: METRIC_IDS.REVIEW_QR_SCAN,
  sessions: METRIC_IDS.SESSION,
  menu_sessions: METRIC_IDS.SESSION,
  google_redirects: METRIC_IDS.GOOGLE_REDIRECT,
  redirects: METRIC_IDS.GOOGLE_REDIRECT,
  google_reviews: METRIC_IDS.GOOGLE_REVIEW,
  actual_google_reviews: METRIC_IDS.GOOGLE_REVIEW,
  staff: METRIC_IDS.STAFF_ATTRIBUTION,
  avg_spend: METRIC_IDS.AVG_SPEND_PER_GUEST,
  delivery: METRIC_IDS.DELIVERY_SALES,
  top_items: METRIC_IDS.TOP_ITEM,
  categories: METRIC_IDS.CATEGORY_PERFORMANCE,
  month: METRIC_IDS.MONTH_TO_DATE,
  mtd: METRIC_IDS.MONTH_TO_DATE,
  partial: METRIC_IDS.PARTIAL_LIVE,
  partial_live: METRIC_IDS.PARTIAL_LIVE,
});

function normalizeMetricId(id) {
  const key = String(id || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return ALIASES[key] || key;
}

/**
 * @param {string} id
 * @returns {MetricDefinition|null}
 */
export function getMetricDefinition(id) {
  const normalized = normalizeMetricId(id);
  return METRIC_DEFINITIONS[normalized] || null;
}

/**
 * @param {string} id
 * @param {'label'|'shortLabel'} [variant='label']
 * @returns {string}
 */
export function getMetricLabel(id, variant = "label") {
  const def = getMetricDefinition(id);
  if (!def) return String(id || "");
  return variant === "shortLabel" ? def.shortLabel : def.label;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function getMetricTooltip(id) {
  const def = getMetricDefinition(id);
  if (!def) return "";
  return `${def.description} Source: ${def.canonicalSource}`;
}

/**
 * @param {string} id
 * @param {object} [context]
 * @param {boolean} [context.partial]
 * @param {boolean} [context.liveFallback]
 * @param {object} [context.operationalTrust]
 * @param {boolean} [context.unavailable]
 * @param {string} [context.selectedRange]
 * @returns {string|null}
 */
export function getMetricWarning(id, context = {}) {
  const def = getMetricDefinition(id);
  if (!def) return null;

  if (context.unavailable || def.dataAvailability === "planned") {
    return def.warningWhenPartial;
  }

  if (id === METRIC_IDS.PARTIAL_LIVE || normalizeMetricId(id) === METRIC_IDS.PARTIAL_LIVE) {
    if (context.partial || context.liveFallback || context.operationalTrust?.partial) {
      return def.warningWhenPartial;
    }
    return null;
  }

  if (context.partial || context.liveFallback || context.operationalTrust?.partial) {
    return def.warningWhenPartial;
  }

  if (def.dataAvailability === "partial" && context.requireExplicitPartial) {
    return def.warningWhenPartial;
  }

  return null;
}

/**
 * Executive-safe banner copy when BI context is refreshing or partial.
 * @param {object} [ctx]
 * @param {boolean} [ctx.loading]
 * @param {boolean} [ctx.partial]
 * @param {boolean} [ctx.liveFallback]
 * @param {object} [ctx.operationalTrust]
 * @param {string|null} [ctx.note]
 * @returns {{ kind: 'updating'|'partial'|'fallback'|null, message: string }|null}
 */
export function resolveIntelligenceStatusBanner(ctx = {}) {
  if (ctx.loading && ctx.hasExistingData) {
    return {
      kind: "updating",
      message: "Updating data… numbers below may refresh when the new range finishes loading.",
    };
  }

  if (ctx.liveFallback) {
    return {
      kind: "fallback",
      message:
        "Live fallback active — totals recomputed from recent menu_events because rollup/RPC was empty or stale.",
    };
  }

  if (ctx.partial || ctx.operationalTrust?.partial || ctx.operationalTrust?.liveFallback) {
    const partialMsg = getMetricWarning(METRIC_IDS.PARTIAL_LIVE, ctx);
    return {
      kind: "partial",
      message: ctx.note || partialMsg || getMetricDefinition(METRIC_IDS.PARTIAL_LIVE).warningWhenPartial,
    };
  }

  return null;
}

export function listMetricDefinitions() {
  return Object.values(METRIC_DEFINITIONS);
}
