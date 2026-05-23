/**
 * Funnel analytics — review tap→Google and menu engagement funnels.
 */

import { tapToGooglePct } from "../../dashboard/utils/reviewFunnelMetrics";
import { canonicalCategoryOpenCount } from "../../lib/menuEventTypes";

export {
  REVIEW_GENERATED_TYPES,
  REVIEW_GOOGLE_TYPES,
  REVIEW_PAGE_OPEN_TYPES,
  clampDisplayPct,
  pct,
  tapToGooglePct,
  interactionToGooglePct,
  cardToReviewPct,
} from "../../dashboard/utils/reviewFunnelMetrics";

const MENU_FUNNEL_KEYS = [
  "qr_scans",
  "category_opens",
  "item_impressions",
  "item_opens",
  "addon_clicks",
  "time_spent",
  "exits",
];

export const EMPTY_MENU_FUNNEL = Object.freeze({
  qr_scans: 0,
  category_opens: 0,
  item_impressions: 0,
  item_opens: 0,
  addon_clicks: 0,
  time_spent: 0,
  exits: 0,
});

/** Build menu funnel object from RPC `by_event_type` map or partial funnel. */
export function buildMenuFunnelFromPayload(payload = {}) {
  const base = { ...EMPTY_MENU_FUNNEL };
  if (payload.funnel && typeof payload.funnel === "object") {
    for (const key of MENU_FUNNEL_KEYS) {
      if (payload.funnel[key] != null) base[key] = Number(payload.funnel[key]) || 0;
    }
    return base;
  }
  const by = payload.by_event_type || {};
  return {
    ...base,
    category_opens: canonicalCategoryOpenCount(by),
    item_impressions: Number(by.item_impression) || 0,
    item_opens: Number(by.item_open) || 0,
    addon_clicks: Number(by.add_on_click ?? by.addon_click) || 0,
    time_spent: Number(by.time_spent) || 0,
    exits: Number(by.exit) || 0,
  };
}

/** Staff / branch row conversion (card taps → Google). */
export function reviewConversionPct(googleRedirects, cardTaps) {
  return tapToGooglePct(googleRedirects, cardTaps);
}

/** Deep interest rate for menu items (opens / impressions). */
export function deepInterestRate(opens, impressions) {
  if (!impressions) return null;
  return Math.round((opens / impressions) * 1000) / 10;
}
