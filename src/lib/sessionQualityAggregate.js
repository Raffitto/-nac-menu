/**
 * Session-quality tiers, funnel (unique sessions per stage), and duration from menu_events.
 */

import {
  isInternalMenuSessionRow,
  normalizeAvgTimeSpent,
  normalizeSessionDurationSeconds,
  MAX_GUEST_SESSION_DURATION_SEC,
  SESSION_IDLE_GAP_SEC,
  PASSIVE_SESSION_EVENT_TYPES,
  ACTIVE_SESSION_EVENT_TYPES,
} from "./sessionMetricsConfig";
import {
  normalizeEventType,
  isAddonInteractionEvent,
} from "./menuEventTypes";
import { computeSessionOperationalMetrics } from "./sessionOperationalMetrics";

const CATEGORY_NAV_TYPES = new Set(["category_open", "menu_tab_open", "section_open"]);

function sessionId(row) {
  const id = (row.session_id || "").trim();
  return id || null;
}

function isCategoryNav(et) {
  return CATEGORY_NAV_TYPES.has(et);
}

/** Span from active timestamps with idle-gap segmentation (ms). */
export function computeActiveSpanSeconds(timestampsMs, idleGapSec = SESSION_IDLE_GAP_SEC) {
  if (!timestampsMs?.length) return 0;
  const sorted = [...timestampsMs].sort((a, b) => a - b);
  const gapMs = idleGapSec * 1000;
  let totalMs = 0;
  let segStart = sorted[0];
  let last = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const t = sorted[i];
    if (t - last > gapMs) {
      totalMs += Math.max(0, last - segStart);
      segStart = t;
    }
    last = t;
  }
  totalMs += Math.max(0, last - segStart);
  return normalizeSessionDurationSeconds(Math.round(totalMs / 1000));
}

export function buildSessionMap(rows) {
  const map = new Map();
  let rawRows = 0;

  for (const row of rows || []) {
    rawRows += 1;
    const sid = sessionId(row);
    if (!sid) continue;
    if (isInternalMenuSessionRow(row)) continue;

    const et = normalizeEventType(row.event_type || "unknown");
    const ts = row.created_at ? new Date(row.created_at).getTime() : NaN;
    const isPassive = PASSIVE_SESSION_EVENT_TYPES.has(et);
    const isActive = ACTIVE_SESSION_EVENT_TYPES.has(et) || isCategoryNav(et);

    let s = map.get(sid);
    if (!s) {
      s = {
        total: 0,
        itemOpens: 0,
        impressions: 0,
        categoryOpens: 0,
        addonClicks: 0,
        searches: 0,
        meaningfulScore: 0,
        durationSec: 0,
        rawSpanSec: 0,
        activeTimestampsMs: [],
        hasQr: false,
        hasActive: false,
        hasTimeSpent: false,
        hasExit: false,
        finalized: false,
      };
      map.set(sid, s);
    }

    s.total += 1;

    if (Number.isFinite(ts)) {
      if (!isPassive) {
        if (s.firstMs == null || ts < s.firstMs) s.firstMs = ts;
        if (s.lastMs == null || ts > s.lastMs) s.lastMs = ts;
      }
      if (isActive) {
        s.activeTimestampsMs.push(ts);
        s.hasActive = true;
      }
    }

    if (et === "qr_session_start") s.hasQr = true;
    if (et === "item_open") {
      s.itemOpens += 1;
      s.meaningfulScore += 2;
    }
    if (et === "item_impression") s.impressions += 1;
    if (isCategoryNav(et)) {
      s.categoryOpens += 1;
      s.meaningfulScore += 1;
    }
    if (isAddonInteractionEvent(et)) {
      s.addonClicks += 1;
      s.meaningfulScore += 2;
    }
    if (et === "search_used" || et === "search_submit") {
      s.searches += 1;
      s.meaningfulScore += 1;
    }

    if (et === "time_spent") {
      s.hasTimeSpent = true;
      if (row.metadata && typeof row.metadata === "object") {
        const d = normalizeSessionDurationSeconds(row.metadata.duration_seconds);
        if (d > s.durationSec) s.durationSec = d;
      }
    }
    if (et === "menu_exit") s.hasExit = true;
  }

  for (const s of map.values()) {
    if (s.firstMs != null && s.lastMs != null && s.lastMs > s.firstMs) {
      s.rawSpanSec = Math.round((s.lastMs - s.firstMs) / 1000);
    }

    const activeSpan = computeActiveSpanSeconds(s.activeTimestampsMs);
    const metaDuration = s.durationSec;
    let duration = 0;

    if (activeSpan > 0) duration = activeSpan;
    else if (metaDuration > 0 && s.hasActive) duration = metaDuration;
    else if (s.rawSpanSec > 0 && s.hasActive && s.itemOpens > 0) {
      duration = normalizeSessionDurationSeconds(
        Math.min(s.rawSpanSec, SESSION_IDLE_GAP_SEC * 4),
      );
    }

    s.durationSec = duration;
    s.finalized = Boolean(s.hasActive && duration > 0);
    s.passiveOnly =
      s.itemOpens === 0 &&
      s.addonClicks === 0 &&
      s.categoryOpens === 0 &&
      s.impressions >= 2;
    s.orphaned = !s.finalized && s.total > 0;
  }

  return { map, rawRows };
}

/** Unique session counts per funnel stage (canonical customer journey). */
export function buildSessionFunnelFromMap(map) {
  const qr = new Set();
  const category = new Set();
  const itemView = new Set();
  const addon = new Set();
  const timeSpent = new Set();
  const exits = new Set();
  const all = new Set();

  for (const [sid, s] of map.entries()) {
    all.add(sid);
    if (s.hasQr) qr.add(sid);
    if (s.categoryOpens > 0) category.add(sid);
    if (s.itemOpens > 0) itemView.add(sid);
    if (s.addonClicks > 0) addon.add(sid);
    if (s.hasTimeSpent) timeSpent.add(sid);
    if (s.hasExit) exits.add(sid);
  }

  const totalSessions = all.size;
  const entry = qr.size > 0 ? qr.size : totalSessions;

  return {
    qr_scans: entry,
    category_opens: category.size,
    item_opens: itemView.size,
    item_impressions: 0,
    addon_clicks: addon.size,
    time_spent: timeSpent.size,
    exits: exits.size,
    total_sessions: totalSessions,
  };
}

export function buildSessionDiagnostics(map, rawEventCount = 0) {
  let orphaned = 0;
  let capped = 0;
  let passiveOnly = 0;
  let finalized = 0;
  let rawDurationSum = 0;
  let correctedDurationSum = 0;

  for (const s of map.values()) {
    if (s.orphaned) orphaned += 1;
    if (s.passiveOnly) passiveOnly += 1;
    if (s.finalized) {
      finalized += 1;
      correctedDurationSum += s.durationSec;
    }
    if (s.rawSpanSec > MAX_GUEST_SESSION_DURATION_SEC) capped += 1;
    if (s.rawSpanSec > 0) rawDurationSum += Math.min(s.rawSpanSec, s.rawSpanSec);
  }

  const validSessions = map.size;
  const passivePct =
    validSessions > 0 ? Math.round((passiveOnly / validSessions) * 1000) / 10 : 0;

  return {
    total_raw_events: rawEventCount,
    valid_sessions: validSessions,
    finalized_sessions: finalized,
    orphaned_sessions_removed: orphaned,
    capped_sessions: capped,
    passive_only_sessions_pct: passivePct,
    avg_raw_duration_sec:
      finalized > 0 ? Math.round(rawDurationSum / Math.max(finalized, 1)) : 0,
    avg_corrected_duration_sec: normalizeAvgTimeSpent(
      finalized > 0 ? correctedDurationSum / finalized : 0,
    ),
  };
}

/** Restaurant-realistic tiers — impressions alone never yield deep/power. */
export function classifySessionTier(stats) {
  if (stats.passiveOnly) return "bounce";

  const duration = Number(stats.durationSec) || 0;
  const { itemOpens, addonClicks, categoryOpens, meaningfulScore } = stats;

  if (itemOpens === 0 && categoryOpens === 0 && duration < 20) return "bounce";
  if (duration > 0 && duration < 15 && itemOpens === 0) return "bounce";

  const canDeep =
    itemOpens >= 2 &&
    (addonClicks >= 1 || categoryOpens >= 2) &&
    meaningfulScore >= 4;
  const canPower =
    itemOpens >= 3 &&
    addonClicks >= 1 &&
    categoryOpens >= 2 &&
    duration >= 5 * 60 &&
    duration <= MAX_GUEST_SESSION_DURATION_SEC;

  if (canPower && duration >= 8 * 60 && duration <= MAX_GUEST_SESSION_DURATION_SEC) {
    return "power";
  }
  if (canDeep && duration >= 5 * 60 && duration <= 12 * 60) return "deep";

  if (itemOpens >= 1 && duration >= 45 && duration < 3 * 60) return "engaged";
  if (itemOpens >= 2 || (itemOpens >= 1 && addonClicks >= 1)) return "engaged";

  if (duration >= 15 || categoryOpens >= 1 || itemOpens === 1) return "casual";

  return "bounce";
}

export function aggregateSessionQualityFromRows(rows) {
  const { map, rawRows } = buildSessionMap(rows);
  const session_quality = { bounce: 0, casual: 0, engaged: 0, deep: 0, power: 0 };

  let durationSum = 0;
  let durationN = 0;
  let itemOpensSum = 0;

  for (const stats of map.values()) {
    const tier = classifySessionTier(stats);
    session_quality[tier] += 1;
    itemOpensSum += stats.itemOpens;
    if (stats.finalized && stats.durationSec > 0) {
      durationSum += stats.durationSec;
      durationN += 1;
    }
  }

  const funnel = buildSessionFunnelFromMap(map);
  const total_sessions = funnel.total_sessions || map.size;
  const bounce_sessions = session_quality.bounce;
  const deep_sessions = session_quality.deep + session_quality.power;
  const session_diagnostics = buildSessionDiagnostics(map, rawRows);

  return {
    session_quality,
    bounce_sessions,
    deep_sessions,
    avg_time_spent: normalizeAvgTimeSpent(durationN > 0 ? durationSum / durationN : 0),
    avg_items_per_session:
      total_sessions > 0 ? Math.round((itemOpensSum / total_sessions) * 10) / 10 : 0,
    total_sessions,
    funnel,
    session_diagnostics,
    session_operational: computeSessionOperationalMetrics(map),
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
