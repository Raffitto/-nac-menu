/**
 * Google review_count snapshot history — daily deltas from Places API captures.
 * Separate from QR/review funnel metrics.
 */

import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { GOOGLE_PLACE_BRANCHES } from "../config/googleBranchPlaces";
import { branchDisplayName } from "./rangeState";
import { NAC_BUSINESS_TZ } from "./businessDay";

export function getRiyadhDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NAC_BUSINESS_TZ }).format(date);
}

export function formatTrackingStartDate(dateKey) {
  if (!dateKey) return "—";
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatMonthSoFarLabel(date = new Date()) {
  const month = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: NAC_BUSINESS_TZ, month: "numeric" }).format(
      date,
    ),
  );
  return dtMonthName(month);
}

function dtMonthName(month) {
  const dt = new Date(Date.UTC(2024, month - 1, 1, 12, 0, 0));
  return dt.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}

function addDaysToDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const nd = new Date(t);
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(nd.getUTCDate()).padStart(2, "0")}`;
}

function monthStartKey(dateKey) {
  const [y, m] = dateKey.split("-");
  return `${y}-${m}-01`;
}

function sortSnapshots(snaps) {
  return [...(snaps || [])].sort((a, b) =>
    String(a.snapshot_date).localeCompare(String(b.snapshot_date)),
  );
}

function snapshotOnOrBefore(sorted, dateKey) {
  let found = null;
  for (const s of sorted) {
    if (String(s.snapshot_date) <= dateKey) found = s;
    else break;
  }
  return found;
}

function previousBefore(sorted, dateKey) {
  let prev = null;
  for (const s of sorted) {
    if (String(s.snapshot_date) < dateKey) prev = s;
    else break;
  }
  return prev;
}

function exactSnapshot(sorted, dateKey) {
  return sorted.find((s) => String(s.snapshot_date) === dateKey) || null;
}

function formatDelta(n) {
  if (n == null || !Number.isFinite(n)) return null;
  if (n > 0) return `+${n}`;
  return String(n);
}

/**
 * Upsert today's snapshot per branch from live Places metrics.
 * Requires authenticated session (RLS).
 */
export async function upsertTodayGoogleReviewSnapshots(byBranch = {}) {
  if (!isSupabaseConfigured() || !supabase) {
    return { data: [], error: null, skipped: true };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { data: [], error: null, skipped: true, reason: "auth_required" };
  }

  const snapshot_date = getRiyadhDateKey();
  const captured_at = new Date().toISOString();
  const rows = GOOGLE_PLACE_BRANCHES.map((branchId) => {
    const m = byBranch[branchId];
    if (m?.totalReviews == null || !Number.isFinite(m.totalReviews)) return null;
    return {
      branch_id: branchId,
      branch_name: branchDisplayName(branchId),
      rating: m.rating != null ? Number(m.rating) : null,
      review_count: Math.round(m.totalReviews),
      snapshot_date,
      captured_at,
    };
  }).filter(Boolean);

  if (!rows.length) {
    return { data: [], error: null, skipped: true, reason: "no_metrics" };
  }

  const { data, error } = await supabase
    .from("google_review_snapshots")
    .upsert(rows, { onConflict: "branch_id,snapshot_date" })
    .select();

  return { data: data || [], error, skipped: false };
}

export async function fetchGoogleReviewSnapshots(branchIds = null) {
  if (!isSupabaseConfigured() || !supabase) {
    return { data: [], error: null };
  }

  let q = supabase
    .from("google_review_snapshots")
    .select(
      "id, branch_id, branch_name, rating, review_count, captured_at, snapshot_date, created_at",
    )
    .order("snapshot_date", { ascending: true });

  const ids = branchIds?.length ? branchIds : GOOGLE_PLACE_BRANCHES;
  q = q.in("branch_id", ids);

  const { data, error } = await q;
  return { data: data || [], error };
}

/**
 * Per-branch movement from stored snapshots (not live Places / not QR funnel).
 */
export function computeBranchGoogleMovement(
  snapshots = [],
  branchId,
  options = {},
) {
  const id = (branchId || "").toLowerCase();
  const referenceDate = options.referenceDate || new Date();
  const periodRange = options.periodRange || "month";
  const todayKey = getRiyadhDateKey(referenceDate);
  const monthKey = monthStartKey(todayKey);
  const weekKey = addDaysToDateKey(todayKey, -6);

  const branchSnaps = sortSnapshots(
    snapshots.filter((s) => (s.branch_id || "").toLowerCase() === id),
  );

  const tracking_start_date = branchSnaps[0]?.snapshot_date || null;
  const latest = branchSnaps[branchSnaps.length - 1] || null;
  const todaySnap = exactSnapshot(branchSnaps, todayKey) || latest;
  const prevBeforeToday = previousBefore(branchSnaps, todayKey);

  const current_review_count = latest?.review_count ?? null;
  const current_rating = latest?.rating != null ? Number(latest.rating) : null;
  const latest_snapshot_date = latest?.snapshot_date || null;
  const baseline_count = branchSnaps[0]?.review_count ?? null;
  const previous_snapshot_count =
    branchSnaps.length >= 2 ? branchSnaps[branchSnaps.length - 2]?.review_count : null;

  let today_delta = null;
  let is_baseline_today = false;
  if (branchSnaps.length === 1) {
    is_baseline_today = true;
  } else if (todaySnap && prevBeforeToday) {
    today_delta = todaySnap.review_count - prevBeforeToday.review_count;
  } else if (latest && prevBeforeToday) {
    today_delta = latest.review_count - prevBeforeToday.review_count;
  }

  const weekBaseline = snapshotOnOrBefore(branchSnaps, weekKey);
  const week_delta =
    latest && weekBaseline
      ? latest.review_count - weekBaseline.review_count
      : null;

  const monthBaseline = snapshotOnOrBefore(branchSnaps, monthKey);
  const month_partial =
    tracking_start_date && String(tracking_start_date) > monthKey;
  let month_delta = null;
  if (latest && monthBaseline) {
    month_delta = latest.review_count - monthBaseline.review_count;
  }

  let selected_period_delta = month_delta;
  if (periodRange === "today") {
    selected_period_delta = today_delta;
  } else if (periodRange === "7d") {
    selected_period_delta = week_delta;
  }

  const history_note = tracking_start_date
    ? `Google review history available from ${formatTrackingStartDate(tracking_start_date)}.`
    : "No Google review snapshots stored yet.";

  return {
    branch_id: id,
    branch_name: branchDisplayName(id),
    tracking_start_date,
    current_rating,
    current_review_count,
    today_delta,
    week_delta,
    month_delta,
    selected_period_delta,
    previous_snapshot_count,
    baseline_count,
    latest_snapshot_date,
    is_baseline_today,
    month_partial,
    month_label: formatMonthSoFarLabel(referenceDate),
    history_note,
    snapshot_count: branchSnaps.length,
  };
}

export function buildAllBranchGoogleMovement(snapshots = [], options = {}) {
  return GOOGLE_PLACE_BRANCHES.map((branchId) =>
    computeBranchGoogleMovement(snapshots, branchId, options),
  );
}

export function formatGoogleMovementChip(report) {
  if (!report?.tracking_start_date) return null;
  if (report.is_baseline_today) return "Baseline";
  if (report.today_delta == null) return null;
  return formatDelta(report.today_delta);
}

export function formatGoogleMovementMonthChip(report) {
  if (!report?.tracking_start_date) return null;
  if (report.month_partial && report.month_delta != null) {
    return `${formatDelta(report.month_delta)} ${report.month_label}*`;
  }
  if (report.month_delta == null) return null;
  return `${formatDelta(report.month_delta)} ${report.month_label}`;
}

/** One-line summary for Branch Audit PDF */
export function formatGoogleMovementLine(report) {
  const star =
    report.current_rating != null
      ? `⭐ ${Number(report.current_rating).toFixed(1)}`
      : "⭐ —";
  const count =
    report.current_review_count != null
      ? `${Number(report.current_review_count).toLocaleString()} reviews`
      : "— reviews";

  let todayPart = "— today";
  if (report.is_baseline_today) {
    todayPart = "Baseline captured";
  } else if (report.today_delta != null) {
    todayPart = `${formatDelta(report.today_delta)} today`;
  }

  let monthPart = "";
  if (!report.tracking_start_date) {
    monthPart = "No snapshot history";
  } else if (report.month_partial) {
    monthPart = report.month_delta != null
      ? `${formatDelta(report.month_delta)} ${report.month_label} so far (from ${formatTrackingStartDate(report.tracking_start_date)})`
      : `Partial ${report.month_label} from ${formatTrackingStartDate(report.tracking_start_date)}`;
  } else if (report.month_delta != null) {
    monthPart = `${formatDelta(report.month_delta)} ${report.month_label} so far`;
  }

  return `${report.branch_name}: ${star} · ${count} · ${todayPart} · ${monthPart}`;
}
