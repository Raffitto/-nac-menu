import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchReviewEventsSummary } from "../../lib/intelligenceQueryApi";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { applyPlatformFilters } from "../utils/platformFilterApply";
import { rangeToSince, rangeToHours, defaultBranchId } from "../utils/rangeState";
import {
  kpisFromReviewSummary,
  staffFromReviewSummary,
  dailyTrendFromReviewSummary,
  branchComparisonFromReviewSummary,
  branchScansFromComparison,
} from "../utils/reviewSummaryMap";
import {
  computeReviewKpis,
  buildBranchReviewComparison,
} from "../utils/reviewEventMetrics";
import {
  aggregateStaffReviewStats,
  mergeStaffStats,
  buildDailyScanTrend,
  buildBranchScanTotals,
} from "../utils/staffReviewStats";
import {
  withSupabaseFallback,
  EMPTY_REVIEW_KPIS,
  isMissingRpcError,
} from "../utils/supabaseResilience";

const REVIEW_EVENT_SELECT =
  "event_type,employee_name,employee_role,branch_id,source_url,created_at,review_session_id,session_id";

/**
 * Shared review intelligence payload — RPC-first, single fetch per filterKey.
 */
export function useReviewIntelligenceData(options = {}) {
  const skip = Boolean(options.skip);
  const platform = usePlatformFiltersOptional();
  const branch = options.branch ?? platform?.branch ?? defaultBranchId();
  const selectedRange = options.selectedRange ?? platform?.selectedRange ?? "today";
  const filterKey =
    options.filterKey ??
    platform?.filterKey ??
    [branch, selectedRange, platform?.language, platform?.shift, platform?.role].join("|");

  const [kpis, setKpis] = useState(null);
  const [staffMerged, setStaffMerged] = useState([]);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [branchScans, setBranchScans] = useState([]);
  const [branchComparison, setBranchComparison] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [partial, setPartial] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setKpis(EMPTY_REVIEW_KPIS);
      setStaffMerged([]);
      setDailyTrend([]);
      setBranchScans([]);
      setBranchComparison([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    setPartial(false);

    const hours = rangeToHours(selectedRange);
    const activeBranch = branch || null;
    const platformFilters = options.platformFilters ?? platform;

    try {
      const summaryResult = await withSupabaseFallback(
        fetchReviewEventsSummary(supabase, { branch: activeBranch, hours }),
        null,
        {
          onError: (e) => {
            if (!isMissingRpcError(e)) setError(e.message || "Review summary unavailable");
          },
        },
      );

      if (summaryResult) {
        const allSummary = await withSupabaseFallback(
          activeBranch
            ? fetchReviewEventsSummary(supabase, { branch: null, hours })
            : Promise.resolve(summaryResult),
          summaryResult,
        );

        const comparison = branchComparisonFromReviewSummary(allSummary || summaryResult);
        setSummary(summaryResult);
        setKpis(kpisFromReviewSummary(summaryResult));
        setStaffMerged(mergeStaffStats([], staffFromReviewSummary(summaryResult)));
        setDailyTrend(dailyTrendFromReviewSummary(summaryResult));
        setBranchComparison(comparison);
        setBranchScans(branchScansFromComparison(comparison));
        if (summaryResult._partial || summaryResult._note) {
          setPartial(true);
          setError(summaryResult._note || "");
        }
        return;
      }

      const since = rangeToSince(selectedRange);
      let reviewQ = supabase
        .from("review_events")
        .select(REVIEW_EVENT_SELECT)
        .order("created_at", { ascending: false })
        .limit(2500);

      if (activeBranch) reviewQ = reviewQ.eq("branch_id", activeBranch);

      let reviewAllQ = supabase
        .from("review_events")
        .select("event_type,branch_id,created_at,review_session_id,session_id")
        .order("created_at", { ascending: false })
        .limit(2000);

      if (since) {
        reviewQ = reviewQ.gte("created_at", since);
        reviewAllQ = reviewAllQ.gte("created_at", since);
      }

      const [{ data: branchEvents }, { data: allEvents }] = await Promise.all([
        reviewQ,
        reviewAllQ,
      ]);

      const events = applyPlatformFilters(branchEvents || [], platformFilters);
      const all = applyPlatformFilters(allEvents || [], platformFilters);
      const comparison = buildBranchReviewComparison(all);

      setSummary(null);
      setKpis(computeReviewKpis(events));
      setStaffMerged(mergeStaffStats([], aggregateStaffReviewStats(events, activeBranch)));
      setDailyTrend(buildDailyScanTrend(events));
      setBranchScans(buildBranchScanTotals(all));
      setBranchComparison(comparison);
    } catch (e) {
      setError(e.message || "Failed to load review data");
      setKpis(EMPTY_REVIEW_KPIS);
      setStaffMerged([]);
      setDailyTrend([]);
      setBranchScans([]);
      setBranchComparison([]);
    } finally {
      setLoading(false);
    }
  }, [branch, selectedRange, platform, options.platformFilters]);

  useEffect(() => {
    if (skip) {
      setLoading(false);
      return;
    }
    load();
  }, [load, skip, filterKey]);

  return useMemo(
    () => ({
      branch,
      selectedRange,
      filterKey,
      kpis,
      staffMerged,
      dailyTrend,
      branchScans,
      branchComparison,
      summary,
      loading,
      error,
      partial,
      reload: load,
    }),
    [
      branch,
      selectedRange,
      filterKey,
      kpis,
      staffMerged,
      dailyTrend,
      branchScans,
      branchComparison,
      summary,
      loading,
      error,
      partial,
      load,
    ],
  );
}
