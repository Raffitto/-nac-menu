import { useState, useEffect, useMemo, useCallback } from "react";
import { resolveReviewPlatformStatus } from "../../platform/engines/platformStatusEngine";
import { buildIntelligenceRangeContract } from "../../platform/engines/timeRangeEngine";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchUnifiedReviewTruth, resolveReviewScope } from "../../lib/unifiedReviewTruth";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useRbacOptional } from "../context/RbacContext";
import { applyPlatformFilters } from "../utils/platformFilterApply";
import { rangeToSince, rangeToHours } from "../utils/rangeState";
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
import { buildBranchComparisonForProfile } from "../../lib/rbacIntelligenceScope";
import { EMPTY_REVIEW_KPIS, isMissingRpcError } from "../utils/supabaseResilience";

const REVIEW_EVENT_SELECT =
  "event_type,employee_name,employee_role,branch_id,source_url,created_at,review_session_id,session_id";

/**
 * Shared review intelligence payload — canonical network truth per filterKey.
 */
export function useReviewIntelligenceData(options = {}) {
  const skip = Boolean(options.skip);
  const platform = usePlatformFiltersOptional();
  const rbac = useRbacOptional();
  const rbacProfile = rbac?.profile;
  const rawBranch = options.branch ?? platform?.branch ?? null;
  const reviewScope = useMemo(
    () => resolveReviewScope(rbacProfile, rawBranch),
    [rbacProfile, rawBranch],
  );
  const selectedRange = options.selectedRange ?? platform?.selectedRange ?? "today";
  const filterKey =
    options.filterKey ??
    platform?.filterKey ??
    [reviewScope.networkWide ? "network" : reviewScope.queryBranch, selectedRange, platform?.language, platform?.shift, platform?.role].join("|");

  const [kpis, setKpis] = useState(null);
  const [staffMerged, setStaffMerged] = useState([]);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [branchScans, setBranchScans] = useState([]);
  const [branchComparison, setBranchComparison] = useState([]);
  const [summary, setSummary] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [scope, setScope] = useState(reviewScope);
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
    const platformFilters = options.platformFilters ?? platform;

    try {
      const truth = await fetchUnifiedReviewTruth(supabase, {
        hours,
        profile: rbacProfile,
        branch: rawBranch,
      });

      if (truth?.summary) {
        setScope(truth.scope);
        setSummary(truth.summary);
        setKpis(truth.kpis);
        setStaffMerged(truth.staffMerged);
        setDailyTrend(truth.dailyTrend);
        setBranchComparison(truth.branchComparison);
        setBranchScans(truth.branchScans);
        setIntegrity(truth.integrity);
        if (truth.partial || truth.note) {
          setPartial(Boolean(truth.partial));
          setError(truth.note || "");
        }
        return;
      }

      const since = rangeToSince(selectedRange);
      let reviewQ = supabase
        .from("review_events")
        .select(REVIEW_EVENT_SELECT)
        .order("created_at", { ascending: false })
        .limit(2500);

      const queryBranch = truth?.scope?.queryBranch ?? reviewScope.queryBranch;
      if (queryBranch) reviewQ = reviewQ.eq("branch_id", queryBranch);
      else if (rbacProfile?.authenticated && !rbacProfile.allBranches && rbacProfile.branchScope) {
        reviewQ = reviewQ.eq("branch_id", rbacProfile.branchScope);
      }

      let reviewAllQ = supabase
        .from("review_events")
        .select("event_type,branch_id,created_at,review_session_id,session_id")
        .order("created_at", { ascending: false })
        .limit(2000);

      if (!reviewScope.networkWide) {
        reviewAllQ = reviewAllQ.eq(
          "branch_id",
          queryBranch || rbacProfile?.branchScope || "__rbac_denied__",
        );
      }

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
      const comparison = buildBranchComparisonForProfile(
        rbacProfile,
        buildBranchReviewComparison(all),
      );

      setSummary(null);
      setScope(reviewScope);
      setKpis(computeReviewKpis(events));
      setStaffMerged(mergeStaffStats([], aggregateStaffReviewStats(events)));
      setDailyTrend(buildDailyScanTrend(events));
      setBranchScans(buildBranchScanTotals(all));
      setBranchComparison(comparison);
      setIntegrity(null);
    } catch (e) {
      setError(e.message || "Failed to load review data");
      setKpis(EMPTY_REVIEW_KPIS);
      setStaffMerged([]);
      setDailyTrend([]);
      setBranchScans([]);
      setBranchComparison([]);
      setIntegrity(null);
    } finally {
      setLoading(false);
    }
  }, [rawBranch, reviewScope, selectedRange, platform, options.platformFilters, rbacProfile]);

  useEffect(() => {
    if (skip) {
      setLoading(false);
      return;
    }
    load();
  }, [load, skip, filterKey]);

  const rangeContract = useMemo(
    () => buildIntelligenceRangeContract(selectedRange),
    [selectedRange],
  );

  const platformStatus = useMemo(
    () =>
      resolveReviewPlatformStatus({
        partial,
        note: error || summary?._note,
        kpis,
        loading,
      }),
    [partial, error, summary?._note, kpis, loading],
  );

  return useMemo(
    () => ({
      branch: scope.displayBranch,
      networkWide: scope.networkWide,
      scope,
      selectedRange,
      filterKey,
      rangeContract,
      kpis,
      staffMerged,
      dailyTrend,
      branchScans,
      branchComparison,
      summary,
      integrity,
      loading,
      error,
      partial,
      platformStatus,
      reload: load,
    }),
    [
      scope,
      selectedRange,
      filterKey,
      rangeContract,
      kpis,
      staffMerged,
      dailyTrend,
      branchScans,
      branchComparison,
      summary,
      integrity,
      loading,
      error,
      partial,
      platformStatus,
      load,
    ],
  );
}
