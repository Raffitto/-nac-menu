import { useState, useEffect, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchReviewEventsSummary } from "../../lib/intelligenceQueryApi";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useRbacOptional } from "../context/RbacContext";
import { rangeToHours } from "../utils/rangeState";
import { staffFromReviewSummary, branchComparisonFromReviewSummary } from "../utils/reviewSummaryMap";
import { fetchGoogleReviewSnapshots } from "../utils/googleReviewSnapshotHistory";
import { buildPredictiveIntelligencePackage } from "../engines/predictiveIntelligenceEngine";
import { cacheKey, getCachedIntelligence, invalidateIntelligenceCache } from "../utils/intelligenceCache";
import { withSupabaseFallback } from "../utils/supabaseResilience";
import {
  buildReviewBranchComparisonForProfile,
  filterExecutiveCommandInput,
  filterReviewIntelligenceInput,
  operationalBranchIdsForProfile,
  rbacScopeCacheKey,
} from "../../lib/rbacIntelligenceScope";
import { resolveRbacQueryBranch } from "../../lib/rbacQueryScope";
import { reviewAllowedBranchIds } from "../config/rbac";

async function loadStaffByBranch(hours, branchIds) {
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
 * Predictive layer built on review data + snapshots (cached per filterKey).
 */
export function usePredictiveIntelligence(reviewData = null, options = {}) {
  const platform = usePlatformFiltersOptional();
  const rbac = useRbacOptional();
  const reviewSurface = Boolean(reviewData);
  const selectedRange = reviewData?.selectedRange ?? platform?.selectedRange ?? "today";
  const activeBranch = reviewData?.networkWide
    ? null
    : (
        reviewData?.branch ??
        resolveRbacQueryBranch(rbac?.profile, platform?.branch) ??
        null
      )?.toLowerCase?.() || null;
  const filterKey =
    reviewData?.filterKey ??
    platform?.filterKey ??
    cacheKey(["predictive", rbacScopeCacheKey(rbac?.profile), activeBranch, selectedRange]);

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

    const key = cacheKey(["predictive", rbacScopeCacheKey(rbac?.profile), filterKey]);

    getCachedIntelligence(key, async () => {
      const hours = rangeToHours(selectedRange);
      const allowedIds = reviewSurface
        ? activeBranch
          ? [activeBranch]
          : reviewAllowedBranchIds(rbac?.profile)
        : operationalBranchIdsForProfile(rbac?.profile);
      const [staffByBranch, snapResult] = await Promise.all([
        loadStaffByBranch(hours, allowedIds),
        fetchGoogleReviewSnapshots(allowedIds).catch(() => ({ data: [] })),
      ]);

      let branchComparison = reviewData?.branchComparison;
      let kpis = reviewData?.kpis;
      let dailyTrend = reviewData?.dailyTrend;

      if (!branchComparison?.length) {
        const net = await withSupabaseFallback(
          fetchReviewEventsSummary(supabase, {
            branch: reviewData?.networkWide ? null : resolveRbacQueryBranch(rbac?.profile, activeBranch),
            hours,
          }),
          null,
        );
        if (net) {
          branchComparison = buildReviewBranchComparisonForProfile(
            rbac?.profile,
            branchComparisonFromReviewSummary(net),
          );
        }
      }

      const input = {
        kpis,
        branchComparison: branchComparison || [],
        staffByBranch,
        snapshots: snapResult?.data || [],
        selectedRange,
        dailyTrend: dailyTrend || [],
        activeBranch,
      };
      const scoped = reviewSurface
        ? filterReviewIntelligenceInput(input, rbac?.profile)
        : filterExecutiveCommandInput(input, rbac?.profile);

      return buildPredictiveIntelligencePackage(scoped);
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
  }, [
    filterKey,
    reviewData?.kpis,
    reviewData?.branchComparison,
    reviewData?.dailyTrend,
    reviewData?.networkWide,
    reviewSurface,
    activeBranch,
    selectedRange,
    rbac?.profile,
  ]);

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
