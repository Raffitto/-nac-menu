/**
 * Google review count queries for Ask NAC Edge.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacEdgeAnswerBuilder.ts";
import { parseFoodicsPeriodFromQuestion } from "./askNacPeriodFallback.ts";

const BRANCH_IDS = ["khobar", "riyadh", "jeddah"];

function resolveSnapshotPeriod(question = "", period: Record<string, unknown> = {}) {
  const q = String(question || "").toLowerCase();
  if (/\blast month\b/.test(q) || period.rangeId === "last_month") {
    const bounds = parseFoodicsPeriodFromQuestion("last month");
    return bounds;
  }
  if (/\bthis month\b|\bmtd\b/.test(q) || period.rangeId === "month") {
    return parseFoodicsPeriodFromQuestion("this month");
  }
  return parseFoodicsPeriodFromQuestion(question);
}

export async function queryGoogleReviewCountEdge(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const branch = (context.branchMention as string) || (context.filters as { branch?: string })?.branch || null;
  const periodBounds = resolveSnapshotPeriod(String(context.question || ""), (context.period as Record<string, unknown>) || {});
  const { data: snapshots = [] } = await supabase
    .from("google_review_snapshots")
    .select("branch_id, branch_name, rating, review_count, snapshot_date")
    .in("branch_id", BRANCH_IDS)
    .order("snapshot_date", { ascending: true });

  const branchSnaps = (snapshots || []).filter(
    (s: Record<string, unknown>) => !branch || String(s.branch_id) === branch,
  );

  let reviewDelta: number | null = null;
  let currentReviewCount: number | null = null;
  let currentRating: number | null = null;

  if (branch && branchSnaps.length) {
    const first = branchSnaps[0];
    const latest = branchSnaps[branchSnaps.length - 1];
    currentReviewCount = latest?.review_count != null ? Number(latest.review_count) : null;
    currentRating = latest?.rating != null ? Number(latest.rating) : null;
    if (periodBounds?.startDate && periodBounds?.endDate) {
      const inPeriod = branchSnaps.filter(
        (s: Record<string, unknown>) =>
          String(s.snapshot_date) >= periodBounds.startDate &&
          String(s.snapshot_date) <= periodBounds.endDate,
      );
      if (inPeriod.length >= 2) {
        reviewDelta = Number(inPeriod[inPeriod.length - 1].review_count) - Number(inPeriod[0].review_count);
      }
    } else if (first && latest) {
      reviewDelta = Number(latest.review_count) - Number(first.review_count);
    }
  } else if (branchSnaps.length) {
    reviewDelta = BRANCH_IDS.reduce((sum, id) => {
      const snaps = branchSnaps.filter((s: Record<string, unknown>) => String(s.branch_id) === id);
      if (snaps.length < 2) return sum;
      return sum + (Number(snaps[snaps.length - 1].review_count) - Number(snaps[0].review_count));
    }, 0);
  }

  return {
    branch,
    branchLabel: branch ? branchDisplayName(branch) : "Network (all branches)",
    periodLabel: periodBounds?.label || "selected period",
    reviewDelta,
    currentReviewCount,
    currentRating,
    sources: [{ name: "google_review_snapshots", detail: "published review count delta" }],
    warnings: !branchSnaps.length ? ["No Google review snapshots stored yet."] : [],
  };
}

export async function probeGoogleReviewSnapshotsEdge(supabase: SupabaseClient) {
  const { count } = await supabase
    .from("google_review_snapshots")
    .select("id", { count: "exact", head: true });
  return { hasSnapshots: (count || 0) > 0, count: count || 0 };
}
