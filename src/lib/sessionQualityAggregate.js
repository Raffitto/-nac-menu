/**
 * Session-quality tiers from menu_events — mirrors server RPC logic with meaningful-interaction depth.
 */

const MEANINGFUL_EVENT_TYPES = new Set([
  "category_open",
  "item_open",
  "item_impression",
  "add_on_click",
  "search_used",
  "search_submit",
]);

function sessionId(row) {
  const id = (row.session_id || "").trim();
  return id || null;
}

function buildSessionMap(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const sid = sessionId(row);
    if (!sid) continue;

    let s = map.get(sid);
    if (!s) {
      s = {
        total: 0,
        itemOpens: 0,
        impressions: 0,
        categoryOpens: 0,
        addonClicks: 0,
        searches: 0,
        meaningful: 0,
        durationSec: 0,
        firstMs: null,
        lastMs: null,
      };
      map.set(sid, s);
    }

    const et = row.event_type || "unknown";
    s.total += 1;

    const ts = row.created_at ? new Date(row.created_at).getTime() : NaN;
    if (Number.isFinite(ts)) {
      if (s.firstMs == null || ts < s.firstMs) s.firstMs = ts;
      if (s.lastMs == null || ts > s.lastMs) s.lastMs = ts;
    }

    if (et === "item_open") s.itemOpens += 1;
    if (et === "item_impression") s.impressions += 1;
    if (et === "category_open") s.categoryOpens += 1;
    if (et === "add_on_click") s.addonClicks += 1;
    if (et === "search_used" || et === "search_submit") s.searches += 1;
    if (MEANINGFUL_EVENT_TYPES.has(et)) s.meaningful += 1;

    if (et === "time_spent" && row.metadata && typeof row.metadata === "object") {
      const d = Number(row.metadata.duration_seconds);
      if (Number.isFinite(d) && d > s.durationSec) s.durationSec = d;
    }
  }

  for (const s of map.values()) {
    if (s.durationSec <= 0 && s.firstMs != null && s.lastMs != null && s.lastMs > s.firstMs) {
      s.durationSec = Math.round((s.lastMs - s.firstMs) / 1000);
    }
  }

  return map;
}

/** Classify one session — aligned with get_session_analytics tiers. */
export function classifySessionTier(stats) {
  const { total, itemOpens, addonClicks, meaningful } = stats;

  if (meaningful <= 1 && itemOpens === 0) return "bounce";
  if (total >= 12 || (itemOpens >= 5 && addonClicks >= 2)) return "power";
  if (total >= 8 || itemOpens >= 3 || (itemOpens >= 2 && addonClicks > 0) || meaningful >= 7) {
    return "deep";
  }
  if (meaningful <= 2 && itemOpens <= 1 && total <= 5) return "casual";
  return "engaged";
}

export function aggregateSessionQualityFromRows(rows) {
  const map = buildSessionMap(rows);
  const session_quality = { bounce: 0, casual: 0, engaged: 0, deep: 0, power: 0 };

  let durationSum = 0;
  let durationN = 0;
  let itemOpensSum = 0;

  for (const stats of map.values()) {
    const tier = classifySessionTier(stats);
    session_quality[tier] += 1;
    itemOpensSum += stats.itemOpens;
    if (stats.durationSec > 0) {
      durationSum += stats.durationSec;
      durationN += 1;
    }
  }

  const total_sessions = map.size;
  const bounce_sessions = session_quality.bounce;
  const deep_sessions = session_quality.deep + session_quality.power;

  return {
    session_quality,
    bounce_sessions,
    deep_sessions,
    avg_time_spent: durationN > 0 ? Math.round(durationSum / durationN) : 0,
    avg_items_per_session:
      total_sessions > 0 ? Math.round((itemOpensSum / total_sessions) * 10) / 10 : 0,
    total_sessions,
  };
}

export function sessionQualityTierSum(sessionQuality) {
  const sq = sessionQuality || {};
  return (
    (Number(sq.bounce) || 0) +
    (Number(sq.casual) || 0) +
    (Number(sq.engaged) || 0) +
    (Number(sq.deep) || 0) +
    (Number(sq.power) || 0)
  );
}

export function sessionQualityIsEmpty(payload) {
  if (!payload) return true;
  const sessions = Number(payload.total_sessions) || 0;
  if (sessions < 1) return true;
  if (sessionQualityTierSum(payload.session_quality) > 0) return false;
  return (
    (Number(payload.bounce_sessions) || 0) === 0 &&
    (Number(payload.deep_sessions) || 0) === 0 &&
    (Number(payload.avg_time_spent) || 0) === 0
  );
}
