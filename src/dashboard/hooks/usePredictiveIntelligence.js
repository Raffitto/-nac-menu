import { useState, useEffect, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchReviewEventsSummary } from "../../lib/intelligenceQueryApi";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { rangeToHours } from "../utils/rangeState";
import {
  staffFromReviewSummary,
  branchComparisonFromReviewSummary,
} from "../utils/reviewSummaryMap";
import { fetchGoogleReviewSnapshots } from "../utils/googleReviewSnapshotHistory";
import { buildPredictiveIntelligencePackage } from "../engines/predictiveIntelligenceEngine";
import { cacheKey, getCachedIntelligence, invalidateIntelligenceCache } from "../utils/intelligenceCache";
import { withSupabaseFallback } from "../utils/supabaseResilience";
import { OPERATIONAL_BRANCHES } from "../engines/branchOperationalReviewEngine";

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
 * Predictive layer built on review data + snapshots (cached per filterKey).
 */
export function usePredictiveIntelligence(reviewData = null, options = {}) {
  const platform = usePlatformFiltersOptional();
  const selectedRange = reviewData?.selectedRange ?? platform?.selectedRange ?? "today";
  const activeBranch = (reviewData?.branch ?? platform?.branch ?? "khobar").toLowerCase();
  const filterKey =
    reviewData?.filterKey ??
    platform?.filterKey ??
    cacheKey(["predictive", activeBranch, selectedRange]);

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

    const key = cacheKey(["predictive", filterKey]);

    getCachedIntelligence(key, async () => {
      const hours = rangeToHours(selectedRange);
      const [staffByBranch, snapResult] = await Promise.all([
        loadStaffByBranch(hours),
        fetchGoogleReviewSnapshots().catch(() => ({ data: [] })),
      ]);

      let branchComparison = reviewData?.branchComparison;
      let kpis = reviewData?.kpis;
      let dailyTrend = reviewData?.dailyTrend;

      if (!branchComparison?.length) {
        const net = await withSupabaseFallback(
          fetchReviewEventsSummary(supabase, { branch: null, hours }),
          null,
        );
        if (net) {
          branchComparison = branchComparisonFromReviewSummary(net);
        }
      }

      return buildPredictiveIntelligencePackage({
        kpis,
        branchComparison: branchComparison || [],
        staffByBranch,
        snapshots: snapResult?.data || [],
        selectedRange,
        dailyTrend: dailyTrend || [],
        activeBranch,
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
          setError(e.message || "Predictive intelligence unavailable");
          setPkg(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filterKey, reviewData?.kpis, reviewData?.branchComparison, reviewData?.dailyTrend, activeBranch, selectedRange]);

  const activeScore = useMemo(
    () => pkg?.scoreByBranch?.[activeBranch] || null,
    [pkg, activeBranch],
  );

  return {
    pkg,
    activeScore,
    loading: loading || reviewData?.loading,
    error: error || reviewData?.error,
    filterKey,
    invalidate: () => invalidateIntelligenceCache("predictive"),
  };
}
