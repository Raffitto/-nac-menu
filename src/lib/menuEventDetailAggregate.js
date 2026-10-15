/**
 * Spec for menu_events_detail_daily.
 * Dashboard reads the rollup. This module is the fixture-tested rule set
 * the SQL refresh follows. It never scans a live table.
 */

export const MAX_DURATION_SEC = 20 * 60;
export const ADDON_PAIR_WINDOW_MS = 3000;
export const SEARCH_QUERY_MAX = 80;

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export function riyadhDayKey(createdAt) {
  const time = new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}

function text(value) {
  const trimmed = String(value || "").trim();
  return trimmed || "";
}

function languageOf(row) {
  const language = text(row.language).toLowerCase();
  if (language === "en" || language === "ar") return language;
  return "unknown";
}

function branchOf(row) {
  return text(row.branch_id).toLowerCase() || "unknown";
}

function durationSeconds(row) {
  const raw = row?.metadata?.duration_seconds;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), MAX_DURATION_SEC);
}

function isShadowAddOn(row) {
  return text(row?.metadata?.source) === "add_on_open";
}

/** Keep one logical add-on click. A shadow row is dropped only when its pair exists. */
export function logicalAddOnClicks(rows = []) {
  const clicks = (rows || []).filter((row) => row.event_type === "add_on_click");
  const real = clicks.filter((row) => !isShadowAddOn(row));
  return clicks.filter((row) => {
    if (!text(row.item_name_en) || !text(row.add_on_name)) return false;
    if (!isShadowAddOn(row)) return true;
    const at = new Date(row.created_at).getTime();
    const paired = real.some((other) => {
      if (text(other.session_id) !== text(row.session_id)) return false;
      if (branchOf(other) !== branchOf(row)) return false;
      if (text(other.item_name_en) !== text(row.item_name_en)) return false;
      if (text(other.add_on_name) !== text(row.add_on_name)) return false;
      const otherAt = new Date(other.created_at).getTime();
      return Number.isFinite(at) && Number.isFinite(otherAt) && Math.abs(otherAt - at) <= ADDON_PAIR_WINDOW_MS;
    });
    return !paired;
  });
}

function bump(map, key, patch) {
  const current = map.get(key) || {
    dayKey: patch.dayKey,
    branchId: patch.branchId,
    kind: patch.kind,
    language: patch.language || "",
    key1: patch.key1 || "",
    key2: patch.key2 || "",
    eventCount: 0,
    sessionIds: new Set(),
    metricSum: 0,
  };
  current.eventCount += patch.eventCount || 0;
  current.metricSum += patch.metricSum || 0;
  if (patch.sessionId) current.sessionIds.add(patch.sessionId);
  map.set(key, current);
}

function rowKey(parts) {
  return parts.map((part) => String(part || "")).join("\u0001");
}

/**
 * Reduce raw events into idempotent daily detail rows.
 * Blank item, category, add-on, and search values are omitted.
 */
export function aggregateMenuEventDetails(rows = []) {
  const map = new Map();
  const ordered = [...(rows || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  for (const row of ordered) {
    const dayKey = riyadhDayKey(row.created_at);
    if (!dayKey) continue;
    const branchId = branchOf(row);
    const sessionId = text(row.session_id);
    const language = languageOf(row);

    if (row.event_type === "item_open" && text(row.item_name_en)) {
      bump(map, rowKey([dayKey, branchId, "item", language, text(row.item_name_en)]), {
        dayKey,
        branchId,
        kind: "item",
        language,
        key1: text(row.item_name_en),
        eventCount: 1,
        sessionId,
      });
    }

    if (row.event_type === "category_open" && text(row.category_id)) {
      bump(map, rowKey([dayKey, branchId, "category", language, text(row.category_id)]), {
        dayKey,
        branchId,
        kind: "category",
        language,
        key1: text(row.category_id),
        eventCount: 1,
        sessionId,
      });
    }

    if (
      (row.event_type === "search_used" || row.event_type === "search_submit")
      && text(row.search_query)
    ) {
      const query = text(row.search_query).toLowerCase().slice(0, SEARCH_QUERY_MAX);
      bump(map, rowKey([dayKey, branchId, "search", language, query]), {
        dayKey,
        branchId,
        kind: "search",
        language,
        key1: query,
        eventCount: 1,
        sessionId,
      });
    }

    if (row.event_type === "time_spent") {
      const seconds = durationSeconds(row);
      if (seconds > 0) {
        bump(map, rowKey([dayKey, branchId, "duration", language]), {
          dayKey,
          branchId,
          kind: "duration",
          language,
          eventCount: 1,
          metricSum: seconds,
          sessionId,
        });
      }
    }
  }

  for (const row of logicalAddOnClicks(ordered)) {
    const dayKey = riyadhDayKey(row.created_at);
    if (!dayKey) continue;
    const branchId = branchOf(row);
    const language = languageOf(row);
    bump(map, rowKey([dayKey, branchId, "addon", language, text(row.item_name_en), text(row.add_on_name)]), {
      dayKey,
      branchId,
      kind: "addon",
      language,
      key1: text(row.item_name_en),
      key2: text(row.add_on_name),
      eventCount: 1,
      sessionId: text(row.session_id),
    });
  }

  const seenSession = new Set();
  for (const row of ordered) {
    const dayKey = riyadhDayKey(row.created_at);
    const sessionId = text(row.session_id);
    if (!dayKey || !sessionId) continue;
    const branchId = branchOf(row);
    const identity = rowKey([dayKey, branchId, sessionId]);
    if (seenSession.has(identity)) continue;
    seenSession.add(identity);
    const language = languageOf(row);
    bump(map, rowKey([dayKey, branchId, "language", language]), {
      dayKey,
      branchId,
      kind: "language",
      key1: language,
      eventCount: 0,
      sessionId,
    });
  }

  return [...map.values()]
    .map((row) => ({
      dayKey: row.dayKey,
      branchId: row.branchId,
      kind: row.kind,
      language: row.language,
      key1: row.key1,
      key2: row.key2,
      eventCount: row.eventCount,
      sessionCount: row.sessionIds.size,
      metricSum: row.metricSum,
    }))
    .sort((a, b) => rowKey([a.dayKey, a.branchId, a.kind, a.language, a.key1, a.key2])
      .localeCompare(rowKey([b.dayKey, b.branchId, b.kind, b.language, b.key1, b.key2])));
}

function matchesScope(row, { branch, language } = {}) {
  if (branch && row.branchId !== String(branch).toLowerCase()) return false;
  if (language && language !== "all") {
    if (row.kind === "language") return row.key1 === language;
    if (row.language !== language) return false;
  }
  return true;
}

function ranked(rows, kind, mapRow, { branch, language, limit }) {
  const totals = new Map();
  for (const row of rows) {
    if (row.kind !== kind || !matchesScope(row, { branch, language })) continue;
    const key = `${row.key1}\u0001${row.key2}`;
    const current = totals.get(key) || { key1: row.key1, key2: row.key2, eventCount: 0, sessionCount: 0 };
    current.eventCount += row.eventCount;
    current.sessionCount += row.sessionCount;
    totals.set(key, current);
  }
  return [...totals.values()]
    .sort((a, b) => b.eventCount - a.eventCount || a.key1.localeCompare(b.key1))
    .slice(0, limit)
    .map(mapRow);
}

/** Shape returned by menu_event_detail_summary. */
export function summarizeMenuEventDetails(detailRows = [], { branch = null, language = "all" } = {}) {
  const scopedLanguage = !language || language === "all" ? null : String(language).toLowerCase();
  const scope = { branch: branch ? String(branch).toLowerCase() : null, language: scopedLanguage };
  const topItems = ranked(detailRows, "item", (row) => ({
    name: row.key1,
    opens: row.eventCount,
    impressions: 0,
  }), { ...scope, limit: 20 });
  const topCategories = ranked(detailRows, "category", (row) => ({
    id: row.key1,
    opens: row.eventCount,
    impressions: 0,
  }), { ...scope, limit: 12 });
  const topSearches = ranked(detailRows, "search", (row) => ({
    query: row.key1,
    count: row.eventCount,
  }), { ...scope, limit: 10 });
  const topAddonPairs = ranked(detailRows, "addon", (row) => ({
    item: row.key1,
    addon: row.key2,
    clicks: row.eventCount,
  }), { ...scope, limit: 12 });

  let durationSum = 0;
  let durationCount = 0;
  const languages = { en: 0, ar: 0, unknown: 0 };
  for (const row of detailRows) {
    if (scope.branch && row.branchId !== scope.branch) continue;
    if (row.kind === "duration") {
      durationSum += row.metricSum;
      durationCount += row.eventCount;
    }
    if (row.kind === "language" && (!scopedLanguage || row.key1 === scopedLanguage)) {
      if (row.key1 === "en" || row.key1 === "ar") languages[row.key1] += row.sessionCount;
      else languages.unknown += row.sessionCount;
    }
  }

  const langEntry = (sessions) => ({ sessions, avg_events: 0, avg_duration: 0 });
  return {
    top_items: topItems,
    top_categories: topCategories,
    top_searches: topSearches,
    top_addon_pairs: topAddonPairs,
    avg_time_spent: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
    lang_behavior: {
      en: langEntry(languages.en),
      ar: langEntry(languages.ar),
      unknown: langEntry(languages.unknown),
    },
  };
}
