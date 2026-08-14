/**
 * Generic operational-source freshness — not Cash-Up-specific.
 * Conservative: a completed business date is not expected until after close + grace.
 */

export const NAC_BUSINESS_TZ = "Asia/Riyadh";

export const DEFAULT_SOURCE_FRESHNESS = Object.freeze({
  timeZone: NAC_BUSINESS_TZ,
  closeHour: 1,
  closeMinute: 15,
  graceHoursAfterClose: 3,
});

export type SourceFreshnessStatus =
  | "current"
  | "pending"
  | "stale"
  | "upstream_stale"
  | "ingestion_stale"
  | "unknown";

export type SourceFreshnessReport = {
  dataset: string;
  branchId: string | null;
  latestCanonicalBusinessDate: string | null;
  latestSourceModifiedAt: string | null;
  latestSuccessfulIngestionAt: string | null;
  expectedLatestCompletedBusinessDate: string | null;
  lagDays: number | null;
  status: SourceFreshnessStatus;
  reason: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function calendarYmdInTz(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function addCalendarDays(year: number, month: number, day: number, delta: number) {
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function inclusiveDayLag(latest: string | null, expected: string | null) {
  if (!latest || !expected) return null;
  const a = Date.parse(`${latest}T00:00:00Z`);
  const b = Date.parse(`${expected}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Latest business date that should already be canonical at `now`,
 * after close (~01:15) plus grace (default 3h → ~04:15 Asia/Riyadh).
 */
export function expectedLatestCompletedBusinessDate(
  now: Date = new Date(),
  options: Partial<typeof DEFAULT_SOURCE_FRESHNESS> = {},
): string {
  const cfg = { ...DEFAULT_SOURCE_FRESHNESS, ...options };
  const wall = calendarYmdInTz(now, cfg.timeZone);
  const yesterday = addCalendarDays(wall.year, wall.month, wall.day, -1);
  const availableHour = cfg.closeHour + cfg.graceHoursAfterClose;
  const availableMinute = cfg.closeMinute;
  const pastGraceToday = wall.hour > availableHour
    || (wall.hour === availableHour && wall.minute >= availableMinute);
  const expected = pastGraceToday
    ? yesterday
    : addCalendarDays(yesterday.year, yesterday.month, yesterday.day, -1);
  return isoDate(expected.year, expected.month, expected.day);
}

export function assessSourceFreshness(input: {
  dataset: string;
  branchId?: string | null;
  latestCanonicalBusinessDate?: string | null;
  latestSourceModifiedAt?: string | null;
  latestSuccessfulIngestionAt?: string | null;
  now?: Date;
  options?: Partial<typeof DEFAULT_SOURCE_FRESHNESS>;
}): SourceFreshnessReport {
  const now = input.now || new Date();
  const expected = expectedLatestCompletedBusinessDate(now, input.options);
  const latest = input.latestCanonicalBusinessDate || null;
  const lagDays = inclusiveDayLag(latest, expected);
  const sourceMod = input.latestSourceModifiedAt ? Date.parse(input.latestSourceModifiedAt) : NaN;
  const ingested = input.latestSuccessfulIngestionAt ? Date.parse(input.latestSuccessfulIngestionAt) : NaN;

  let status: SourceFreshnessStatus = "unknown";
  let reason = "Canonical coverage for this source has not been established.";

  if (latest && lagDays != null && lagDays <= 0) {
    status = "current";
    reason = `Canonical ${input.dataset} is current through ${latest}.`;
  } else if (!latest) {
    status = "stale";
    reason = `No canonical ${input.dataset} business dates are available.`;
  } else if (lagDays === 1) {
    const cfg = { ...DEFAULT_SOURCE_FRESHNESS, ...(input.options || {}) };
    const wall = calendarYmdInTz(now, cfg.timeZone);
    const availableHour = cfg.closeHour + cfg.graceHoursAfterClose;
    const pastGrace = wall.hour > availableHour
      || (wall.hour === availableHour && wall.minute >= cfg.closeMinute);
    if (!pastGrace) {
      status = "pending";
      reason = `Canonical ${input.dataset} is pending the latest completed day ${expected} (within close+grace).`;
    } else {
      status = "stale";
      reason = `Canonical ${input.dataset} is missing completed day ${expected}.`;
    }
  } else {
    status = "stale";
    reason = `Canonical ${input.dataset} ends ${latest} but ${expected} should already be available.`;
  }

  if (status !== "current" && status !== "pending" && latest) {
    if (Number.isFinite(sourceMod) && Number.isFinite(ingested) && ingested + 1000 < sourceMod) {
      status = "ingestion_stale";
      reason = `The official ${input.dataset} source was updated after the last successful canonical ingest.`;
    } else if (Number.isFinite(sourceMod)) {
      const expectedEnd = Date.parse(`${expected}T00:00:00Z`);
      if (Number.isFinite(expectedEnd) && sourceMod < expectedEnd) {
        status = "upstream_stale";
        reason = `The official ${input.dataset} source has not been updated through ${expected}.`;
      }
    }
  }

  return {
    dataset: input.dataset,
    branchId: input.branchId || null,
    latestCanonicalBusinessDate: latest,
    latestSourceModifiedAt: input.latestSourceModifiedAt || null,
    latestSuccessfulIngestionAt: input.latestSuccessfulIngestionAt || null,
    expectedLatestCompletedBusinessDate: expected,
    lagDays,
    status,
    reason,
  };
}
