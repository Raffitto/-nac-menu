import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { fetchReviewEventsSummary } from "../../lib/intelligenceQueryApi";
import { mergeReviewIntoOperationalPayload } from "../../lib/operationalDashboardEnrich";
import { applyTruthToBiPayload } from "../../lib/unifiedOperationalTruth";
import { applyOperationalIntegrityToPayload } from "../../lib/operationalMetricsIntegrity";
import { normalizeBranchForRpc } from "../../lib/menuEventsBiFallback";
import { hoursFromPlatformFilters } from "../../platform/engines/timeRangeEngine";
import { useMenuBiDashboard } from "./useMenuBiDashboard";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";

async function fetchActivityFeed(hours, branch) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc("get_session_analytics_feed", {
      p_branch: normalizeBranchForRpc(branch),
      p_hours: hours,
      p_limit: 25,
    });
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Canonical operational dashboard loader — menu BI truth + review funnel + activity feed.
 */
export function useOperationalDashboard(options = {}) {
  const { enabled = true, refreshIntervalMs = 0, source = "useOperationalDashboard" } = options;
  const filters = usePlatformFiltersOptional();
  const hours = hoursFromPlatformFilters(filters || {});

  const menuBi = useMenuBiDashboard({
    enabled,
    refreshIntervalMs,
    source,
  });

  const [reviewSummary, setReviewSummary] = useState(null);
  const [activityFeed, setActivityFeed] = useState([]);
  const [activeGuestsNow, setActiveGuestsNow] = useState(0);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [reviewPartialNote, setReviewPartialNote] = useState(null);

  useEffect(() => {
    setReviewSummary(null);
    setActivityFeed([]);
    setReviewPartialNote(null);
  }, [hours, filters?.branch]);

  const loadEnrichment = useCallback(async () => {
    if (!enabled || !supabase || menuBi.needsAuth) {
      setReviewSummary(null);
      setActivityFeed([]);
      setActiveGuestsNow(0);
      return;
    }
    setEnrichLoading(true);
    try {
      const [review, feed, liveRes] = await Promise.all([
        fetchReviewEventsSummary(supabase, {
          branch: filters?.branch,
          hours,
        }),
        fetchActivityFeed(hours, filters?.branch),
        supabase.rpc("get_live_activity"),
      ]);
      setReviewSummary(review);
      setReviewPartialNote(
        review?._partial
          ? review._note || "Review metrics reflect today only — wider range timed out."
          : null,
      );
      setActivityFeed(feed);
      const live = liveRes?.data;
      setActiveGuestsNow(Number(live?.active_sessions) || 0);
    } catch {
      setReviewSummary(null);
      setReviewPartialNote(null);
      setActivityFeed([]);
      setActiveGuestsNow(0);
    } finally {
      setEnrichLoading(false);
    }
  }, [enabled, menuBi.needsAuth, filters?.branch, hours]);

  useEffect(() => {
    if (!menuBi.loading && menuBi.data) {
      loadEnrichment();
    }
  }, [menuBi.loading, menuBi.data, loadEnrichment]);

  useEffect(() => {
    if (!enabled || !supabase || menuBi.needsAuth || !filters?.liveMode) return undefined;
    const pollActive = async () => {
      try {
        const liveRes = await supabase.rpc("get_live_activity");
        setActiveGuestsNow(Number(liveRes?.data?.active_sessions) || 0);
      } catch {
        /* keep last value */
      }
    };
    pollActive();
    const id = setInterval(pollActive, 5000);
    return () => clearInterval(id);
  }, [enabled, menuBi.needsAuth, filters?.liveMode]);

  const data = useMemo(() => {
    if (!menuBi.data) return null;
    const merged = mergeReviewIntoOperationalPayload(menuBi.data, reviewSummary);
    const truthed = applyTruthToBiPayload(merged, { hours, branch: filters?.branch });
    return applyOperationalIntegrityToPayload(truthed, { hours, branch: filters?.branch });
  }, [menuBi.data, reviewSummary, hours, filters?.branch]);

  const reload = useCallback(async () => {
    await menuBi.reload();
    await loadEnrichment();
  }, [menuBi, loadEnrichment]);

  return {
    ...menuBi,
    data,
    truth: data?._truth || menuBi.truth,
    reviewSummary,
    reviewPartialNote,
    activityFeed,
    activeGuestsNow,
    enrichLoading,
    reload,
    loading: menuBi.loading || enrichLoading,
  };
}
