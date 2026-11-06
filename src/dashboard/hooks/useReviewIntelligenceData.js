import { useState, useEffect, useMemo, useCallback } from "react";
import { resolveReviewPlatformStatus } from "../../platform/engines/platformStatusEngine";
import { buildIntelligenceRangeContract } from "../../platform/engines/timeRangeEngine";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchUnifiedReviewTruth, resolveReviewScope } from "../../lib/unifiedReviewTruth";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useRbacOptional } from "../context/RbacContext";
import { rangeToHours } from "../utils/rangeState";
import { EMPTY_REVIEW_KPIS } from "../utils/supabaseResilience";

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
    let settled = false;
    const settleTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setPartial(true);
      setError((prev) => prev || "Complete review metrics timed out; please retry.");
      setLoading(false);
    }, 12000);

    try {
      const truth = await fetchUnifiedReviewTruth(supabase, {
        hours,
        profile: rbacProfile,
        branch: rawBranch,
      });

      if (truth?.summary) {
        setScope(truth.scope);
        if (truth.partial) {
          setSummary(null);
          setKpis(null);
          setStaffMerged([]);
          setDailyTrend([]);
          setBranchComparison([]);
          setBranchScans([]);
          setIntegrity(null);
          setPartial(true);
          setError(truth.note || "Complete review summary is unavailable; please retry.");
          return;
        }
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

      // Raw-event queries are capped and cannot represent complete period totals.
      setPartial(true);
      setError("Complete review summary is unavailable; please retry.");

      setSummary(null);
      setKpis(null);
      setStaffMerged([]);
      setDailyTrend([]);
      setBranchScans([]);
      setBranchComparison([]);
      setIntegrity(null);
    } catch (e) {
      setPartial(true);
      setError(e.message || "Failed to load review data");
      setKpis(null);
      setStaffMerged([]);
      setDailyTrend([]);
      setBranchScans([]);
      setBranchComparison([]);
      setIntegrity(null);
    } finally {
      clearTimeout(settleTimer);
      settled = true;
      setLoading(false);
    }
  }, [rawBranch, selectedRange, rbacProfile]);

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
