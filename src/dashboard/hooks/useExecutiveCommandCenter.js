import { useState, useEffect, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchReviewEventsSummary } from "../../lib/intelligenceQueryApi";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { rangeToHours } from "../utils/rangeState";
import { staffFromReviewSummary } from "../utils/reviewSummaryMap";
import { fetchGoogleReviewSnapshots } from "../utils/googleReviewSnapshotHistory";
import { buildExecutiveCommandCenterPackage } from "../engines/executiveCommandCenterEngine";
import { cacheKey, getCachedIntelligence } from "../utils/intelligenceCache";
import { withSupabaseFallback } from "../utils/supabaseResilience";
import { OPERATIONAL_BRANCHES } from "../engines/branchOperationalReviewEngine";
import { useReviewIntelligenceData } from "./useReviewIntelligenceData";

async function loadStaffByBranch(hours) {
  const pairs = await Promise.all(
    OPERATIONAL_BRANCHES.map(async (branchId) => {
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
  const selectedRange = platform?.selectedRange ?? "today";
  const filterKey = platform?.filterKey ?? cacheKey(["ecc", selectedRange]);

  const reviewData = useReviewIntelligenceData({ networkWide: true, selectedRange });

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

    const key = cacheKey(["executive-cc", filterKey]);

    getCachedIntelligence(key, async () => {
      const hours = rangeToHours(selectedRange);
      const [staffByBranch, snapResult] = await Promise.all([
        loadStaffByBranch(hours),
        fetchGoogleReviewSnapshots().catch(() => ({ data: [] })),
      ]);

      return buildExecutiveCommandCenterPackage({
        kpis: reviewData.kpis,
        branchComparison: reviewData.branchComparison || [],
        staffByBranch,
        snapshots: snapResult?.data || [],
        selectedRange,
        dailyTrend: reviewData.dailyTrend || [],
      });
    })
      .then((data) => {
        if (!cancelled) {
          setPkg(data);
          setLoading(false);
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
