/**
 * Hourly / daily bucket labels — Asia/Riyadh business-day aware, safe fallbacks.
 */

import { getBusinessDayKey } from "./businessDay";

const RIYADH = "Asia/Riyadh";

export function hourInRiyadh(iso) {
  if (iso == null || iso === "" || iso === "unknown") return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: RIYADH,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(iso));
    const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    return h === 24 ? 0 : h;
  } catch {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.getHours();
  }
}

/**
 * @returns {{ kind: 'hour'|'day'|'invalid', hour: number|null, dateKey: string|null, granularity: string }}
 */
export function parseHourBucket(raw, granularityHint) {
  if (raw == null || raw === "" || raw === "unknown") {
    return { kind: "invalid", hour: null, dateKey: null, granularity: granularityHint || "hour" };
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw >= 0 && raw <= 23) {
      return { kind: "hour", hour: raw, dateKey: null, granularity: "hour" };
    }
  }

  const s = String(raw).trim();

  if (/^\d{1,2}$/.test(s)) {
    const h = parseInt(s, 10);
    if (h >= 0 && h <= 23) {
      return { kind: "hour", hour: h, dateKey: null, granularity: "hour" };
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { kind: "day", hour: null, dateKey: s, granularity: "day" };
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{1,2}$/.test(s)) {
    const h = parseInt(s.slice(11, 13), 10);
    if (h >= 0 && h <= 23) {
      return { kind: "hour", hour: h, dateKey: s.slice(0, 10), granularity: "hour" };
    }
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const h = hourInRiyadh(s);
    if (h != null) {
      return { kind: "hour", hour: h, dateKey: s.slice(0, 10), granularity: "hour" };
    }
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    if (granularityHint === "day" || (!s.includes("T") && !s.includes(":") && s.length <= 10)) {
      return {
        kind: "day",
        hour: null,
        dateKey: s.slice(0, 10),
        granularity: "day",
      };
    }
    const h = hourInRiyadh(d);
    return { kind: "hour", hour: h, dateKey: null, granularity: "hour" };
  }

  return { kind: "invalid", hour: null, dateKey: null, granularity: granularityHint || "hour", raw: s };
}

export function detectHourlyGranularity(byHour = []) {
  const rows = byHour || [];
  if (!rows.length) return "hour";
  const dayVotes = rows.filter(
    (r) => r.granularity === "day" || parseHourBucket(r.hour ?? r.business_day_key, "day").kind === "day",
  ).length;
  return dayVotes > rows.length / 2 ? "day" : "hour";
}

/** Last N NAC business-day keys ending at referenceDate. */
export function businessDayKeysForRange(dayCount, referenceDate = new Date()) {
  const n = Math.max(1, Math.min(Number(dayCount) || 7, 45));
  const keys = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(referenceDate.getTime() - i * 86400000);
    keys.push(getBusinessDayKey(d));
  }
  return keys;
}

/** Ensure 24 Riyadh hour slots (zeros where no activity). */
export function fill24HourBuckets(byHour = []) {
  const counts = new Map();
  for (const row of byHour || []) {
    const raw = row.hour ?? row.business_day_key ?? row.day_key;
    const gran = row.granularity || parseHourBucket(raw).granularity;
    if (gran === "day") continue;
    const parsed = parseHourBucket(raw, gran);
    let hour = parsed.hour;
    if (hour == null && (typeof raw === "string" || raw instanceof Date)) {
      hour = hourInRiyadh(raw);
    }
    if (hour == null && typeof raw === "number" && raw >= 0 && raw <= 23) {
      hour = raw;
    }
    if (hour == null) continue;
    counts.set(hour, (counts.get(hour) || 0) + (Number(row.count) || 0));
  }
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: counts.get(hour) || 0,
    granularity: "hour",
    business_day_key: null,
  }));
}

/** Fill missing calendar days in range (rollup / 7D charts). */
export function fillDayBuckets(byHour = [], dayKeys = []) {
  const keys =
    dayKeys?.length > 0
      ? dayKeys
      : [...new Set(
          (byHour || [])
            .map((r) => {
              const raw = r.hour ?? r.business_day_key ?? r.day_key;
              const parsed = parseHourBucket(raw, r.granularity || "day");
              return parsed.dateKey || String(raw).slice(0, 10);
            })
            .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)),
        )].sort();

  const counts = new Map();
  for (const row of byHour || []) {
    const raw = row.hour ?? row.business_day_key ?? row.day_key;
    const parsed = parseHourBucket(raw, row.granularity || "day");
    const key = parsed.dateKey || String(raw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    counts.set(key, (counts.get(key) || 0) + (Number(row.count) || 0));
  }

  const ordered = keys.length ? keys : [...counts.keys()].sort();
  return ordered.map((key) => ({
    hour: key,
    business_day_key: key,
    count: counts.get(key) || 0,
    granularity: "day",
  }));
}

/**
 * Normalize sparse RPC/fallback buckets for charts.
 * @param {object} [options]
 * @param {number} [options.dayCount] — for day granularity fill (default 7)
 */
export function normalizeHourlyDistribution(byHour = [], options = {}) {
  const rows = byHour || [];
  if (!rows.length) {
    return options.granularity === "day"
      ? fillDayBuckets([], businessDayKeysForRange(options.dayCount || 7))
      : fill24HourBuckets([]);
  }

  const gran = options.granularity || detectHourlyGranularity(rows);
  if (gran === "day") {
    const dayKeys =
      options.dayKeys ||
      businessDayKeysForRange(options.dayCount || Math.max(7, rows.length));
    return fillDayBuckets(rows, dayKeys);
  }
  return fill24HourBuckets(rows);
}

/** Chart axis label: `03:00`, `14:00` for hours; `May 12` for day buckets. */
export function formatHourBucketLabel(raw, granularityHint) {
  const parsed = parseHourBucket(raw, granularityHint);
  const gran = granularityHint || parsed.granularity || "hour";

  if (gran === "day" || parsed.kind === "day") {
    const key = parsed.dateKey || String(raw).slice(0, 10);
    if (!key || !/^\d{4}-\d{2}-\d{2}/.test(key)) return "—";
    const d = new Date(`${key}T12:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return key;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: RIYADH,
      month: "short",
      day: "numeric",
    }).format(d);
  }

  if (parsed.hour != null && parsed.hour >= 0 && parsed.hour <= 23) {
    return `${String(parsed.hour).padStart(2, "0")}:00`;
  }

  const slice = String(raw).slice(11, 16);
  if (/^\d{2}:\d{2}$/.test(slice)) return slice;

  const h = hourInRiyadh(raw);
  if (h != null) return `${String(h).padStart(2, "0")}:00`;

  return "—";
}

export function formatDayBucketLabel(raw) {
  return formatHourBucketLabel(raw, "day");
}

/** Recharts-ready hourly rows with stable labels. */
export function hourlyChartRows(byHour = [], options = {}) {
  const failures = options.parseFailures || { count: 0 };
  const source =
    options.fillGaps === false
      ? byHour || []
      : normalizeHourlyDistribution(byHour || [], {
          granularity: options.granularity,
          dayCount: options.dayCount,
          dayKeys: options.dayKeys,
        });

  return source.map((row) => {
    const gran = row.granularity || parseHourBucket(row.hour ?? row.business_day_key).granularity;
    const raw = row.hour ?? row.business_day_key ?? row.day_key;
    const label = formatHourBucketLabel(raw, gran);
    if (label === "—") failures.count += 1;
    const parsed = parseHourBucket(raw, gran);
    return {
      label,
      count: Number(row.count) || 0,
      hour: parsed.hour,
      granularity: gran,
      bucket: raw,
    };
  });
}
