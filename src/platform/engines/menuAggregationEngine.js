/**
 * Menu BI aggregation — items, categories, add-on pairs (single merge/normalize path).
 */

import { deepInterestRate } from "./funnelAnalyticsEngine";

export function mergeTopItemsByName(items = []) {
  const map = new Map();
  for (const t of items) {
    const name = (t.name || t.item_name_en || t.item_name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const prev = map.get(key) || {
      name,
      impressions: 0,
      opens: 0,
      impression_sessions: 0,
      visible_duration_ms: 0,
      avg_visible_duration_ms: 0,
    };
    prev.impressions += Number(t.impressions) || 0;
    prev.opens += Number(t.opens ?? t.modal_opens ?? t.item_opens) || 0;
    prev.impression_sessions += Number(t.impression_sessions) || 0;
    prev.visible_duration_ms += Number(t.visible_duration_ms) || 0;
    map.set(key, prev);
  }
  return [...map.values()]
    .map((t) => ({
      ...t,
      deep_interest_rate: deepInterestRate(t.opens, t.impressions),
      avg_visible_duration_ms:
        t.impression_sessions > 0
          ? Math.round(t.visible_duration_ms / t.impression_sessions)
          : 0,
    }))
    .sort((a, b) => visibilityEngagementScore(b) - visibilityEngagementScore(a));
}

/** Weighted visibility score — impressions, opens, open ratio, dwell. */
export function visibilityEngagementScore(item = {}) {
  const imp = Number(item.impressions) || 0;
  const opens = Number(item.opens ?? item.modal_opens) || 0;
  const rate = imp > 0 ? opens / imp : opens > 0 ? 1 : 0;
  const dwellSec = Math.min((Number(item.avg_visible_duration_ms) || 0) / 1000, 120);
  return imp * 1 + opens * 2.5 + rate * 40 + dwellSec * 0.15;
}

export function mergeCategoriesById(items = []) {
  const map = new Map();
  for (const c of items) {
    const id = (c.id || c.category_id || "").trim();
    if (!id) continue;
    const key = id.toLowerCase();
    const prev = map.get(key) || { id, opens: 0, impressions: 0 };
    prev.opens += Number(c.opens) || 0;
    prev.impressions += Number(c.impressions) || 0;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => b.opens - a.opens || b.impressions - a.impressions);
}

export function normalizeAddonPairs(pairs = []) {
  const map = new Map();
  for (const p of pairs) {
    const item = (p.item || p.item_name || "").trim();
    const addon = (p.addon || p.add_on_name || "").trim();
    if (!item || !addon) continue;
    const key = `${item.toLowerCase()}::${addon.toLowerCase()}`;
    const prev = map.get(key) || { item, addon, clicks: 0 };
    prev.clicks += Number(p.clicks) || 0;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => b.clicks - a.clicks);
}

/** Raw RPC rows → merged chart-ready rows. */
export function normalizeMenuBiAggregates(raw = {}) {
  return {
    top_items: mergeTopItemsByName(
      Array.isArray(raw.top_items)
        ? raw.top_items.map((t) => ({
            name: t.name || t.item_name_en || t.item_name || "",
            impressions: Number(t.impressions) || 0,
            opens: Number(t.opens ?? t.modal_opens ?? t.item_opens) || 0,
            impression_sessions: Number(t.impression_sessions) || 0,
            visible_duration_ms: Number(t.visible_duration_ms) || 0,
            deep_interest_rate:
              t.deep_interest_rate != null ? Number(t.deep_interest_rate) : null,
            avg_visible_duration_ms: Number(t.avg_visible_duration_ms) || 0,
          }))
        : [],
    ),
    top_categories: mergeCategoriesById(
      Array.isArray(raw.top_categories)
        ? raw.top_categories.map((c) => ({
            id: c.id || c.category_id || "",
            opens: Number(c.opens) || 0,
            impressions: Number(c.impressions) || 0,
          }))
        : [],
    ),
    top_addon_pairs: normalizeAddonPairs(raw.top_addon_pairs || []),
  };
}
