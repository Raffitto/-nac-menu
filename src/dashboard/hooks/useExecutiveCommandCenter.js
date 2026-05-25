import { useState, useEffect, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchReviewEventsSummary } from "../../lib/intelligenceQueryApi";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { rangeToHours } from "../utils/rangeState";
import { staffFromReviewSummary } from "../utils/reviewSummaryMap";
import { fetchGoogleReviewSnapshots } from "../utils/googleReviewSnapshotHistory";
import { buildExecutiveCommandCenterPackage } from "../engines/executiveCommandCenterEngine";
import { cacheKey, getCachedIntelligence } from "../utils/intelligenceCache";
import { logBiIntelligenceDiagnostics } from "../../lib/intelligenceDiagnostics";
import { withSupabaseFallback } from "../utils/supabaseResilience";
import { useReviewIntelligenceData } from "./useReviewIntelligenceData";
import { useRbacOptional } from "../context/RbacContext";
import { canFetchCrossBranchComparison } from "../../lib/rbacQueryScope";
import {
  filterCommandCenterPackage,
  filterExecutiveCommandInput,
  operationalBranchIdsForProfile,
  rbacScopeCacheKey,
} from "../../lib/rbacIntelligenceScope";

async function loadStaffByBranch(hours, rbacProfile) {
  const branchIds = operationalBranchIdsForProfile(rbacProfile);
  const pairs = await Promise.all(
    branchIds.map(async (branchId) => {
      const summary = await withSupabaseFallback(
        fetchReviewEventsSummary(supabase, { branch: branchId, hours }),
        null,
      );
      return [branchId, staffFromReviewSummary(summary || { staff: [] })];
    }),
  );
  return Object.fromEntries(pairs);
}

/**
 * Executive Command Center data — network-wide review + predictive + command package (cached).
 */
export function useExecutiveCommandCenter() {
  const platform = usePlatformFiltersOptional();
  const rbac = useRbacOptional();
  const selectedRange = platform?.selectedRange ?? "today";
  const filterKey = platform?.filterKey ?? cacheKey(["ecc", selectedRange]);

  const reviewData = useReviewIntelligenceData({
    branch: canFetchCrossBranchComparison(rbac?.profile) ? null : platform?.branch,
    selectedRange,
  });

  const [pkg, setPkg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      setPkg(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const key = cacheKey(["executive-cc", rbacScopeCacheKey(rbac?.profile), filterKey]);

    getCachedIntelligence(key, async () => {
      const hours = rangeToHours(selectedRange);
      const [staffByBranch, snapResult] = await Promise.all([
        loadStaffByBranch(hours, rbac?.profile),
        fetchGoogleReviewSnapshots().catch(() => ({ data: [] })),
      ]);

      const scopedInput = filterExecutiveCommandInput(
        {
          kpis: reviewData.kpis,
          branchComparison: reviewData.branchComparison || [],
          staffByBranch,
          snapshots: snapResult?.data || [],
          selectedRange,
          dailyTrend: reviewData.dailyTrend || [],
        },
        rbac?.profile,
      );

      const rawPkg = buildExecutiveCommandCenterPackage(scopedInput);

      return filterCommandCenterPackage(rawPkg, rbac?.profile);
    })
      .then((data) => {
        if (!cancelled) {
          setPkg(data);
          setLoading(false);
          logBiIntelligenceDiagnostics({
            source: "ExecutiveCommandCenter",
            selectedRange,
            commandCenter: {
              networkScore: data?.networkScore,
              networkScoreBuilding: data?.networkScoreBuilding,
              branchScores: (data?.branchScores || []).map((b) => ({
                branch: b.branch_id,
                score: b.score,
                provisional: b.provisional,
                insufficient: b.insufficient_data,
              })),
              pulse: data?.pulse,
            },
          });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || "Executive command center unavailable");
          setPkg(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    filterKey,
    selectedRange,
    reviewData.kpis,
    reviewData.branchComparison,
    reviewData.dailyTrend,
    rbac?.profile,
  ]);

  const isLoading = loading || reviewData.loading;

  return useMemo(
    () => ({
      pkg,
      reviewData,
      loading: isLoading,
      error: error || reviewData.error,
      filterKey,
      selectedRange,
    }),
    [pkg, reviewData, isLoading, error, filterKey, selectedRange],
  );
}
