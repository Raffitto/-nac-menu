/**
 * Hourly / daily bucket labels — Asia/Riyadh business-day aware, safe fallbacks.
 */

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

  return (byHour || []).map((row) => {
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
