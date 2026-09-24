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
  if (!supabase) return { rows: [], status: "unavailable" };
  try {
    const { data, error } = await supabase.rpc("get_session_analytics_feed", {
      p_branch: normalizeBranchForRpc(branch),
      p_hours: hours,
      p_limit: 25,
    });
    if (error) return { rows: [], status: "unavailable" };
    return { rows: Array.isArray(data) ? data : [], status: "success" };
  } catch {
    return { rows: [], status: "unavailable" };
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
  /** null = unavailable/error — never coerce failed live poll into 0. */
  const [activeGuestsNow, setActiveGuestsNow] = useState(null);
  const [activeGuestsStatus, setActiveGuestsStatus] = useState("loading");
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [reviewPartialNote, setReviewPartialNote] = useState(null);
  const [enrichError, setEnrichError] = useState(null);

  const loadEnrichment = useCallback(async () => {
    if (!enabled || !supabase || menuBi.needsAuth) {
      return;
    }
    setEnrichLoading(true);
    setEnrichError(null);
    try {
      const withDeadline = (promise, ms, fallback) => {
        let timer;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve(fallback), ms);
        });
        return Promise.race([promise, timeout]).finally(() => {
          if (timer) clearTimeout(timer);
        });
      };
      const [review, feed, liveRes] = await Promise.all([
        withDeadline(
          fetchReviewEventsSummary(supabase, {
            branch: filters?.branch,
            hours,
          }),
          10000,
          null,
        ),
        withDeadline(fetchActivityFeed(hours, filters?.branch), 8000, {
          rows: [],
          status: "unavailable",
        }),
        withDeadline(supabase.rpc("get_live_activity"), 8000, {
          data: null,
          error: { message: "timeout", code: "57014" },
        }),
      ]);
      setReviewSummary(review);
      setReviewPartialNote(
        review?._partial
          ? review._note || "Review metrics reflect today only — wider range timed out."
          : review
            ? null
            : "Review metrics did not load. Menu metrics are still shown.",
      );
      if (feed?.status === "unavailable") {
        setActivityFeed([]);
        setEnrichError("Recent activity timed out — not a verified empty feed.");
      } else {
        setActivityFeed(Array.isArray(feed?.rows) ? feed.rows : []);
      }
      if (liveRes?.error || !liveRes?.data) {
        setActiveGuestsNow(null);
        setActiveGuestsStatus("unavailable");
      } else {
        setActiveGuestsNow(Number(liveRes.data.active_sessions) || 0);
        setActiveGuestsStatus("success");
      }
    } catch {
      setReviewPartialNote("Could not load this panel");
      setEnrichError("Enrichment failed — metrics below may be incomplete.");
      setActiveGuestsNow(null);
      setActiveGuestsStatus("unavailable");
    } finally {
      setEnrichLoading(false);
    }
  }, [enabled, menuBi.needsAuth, filters?.branch, hours]);

  useEffect(() => {
    if (!enabled) return;
    if (menuBi.loading || !menuBi.data || menuBi.data._tier1Partial) return;
    loadEnrichment();
  }, [enabled, menuBi.loading, menuBi.data, loadEnrichment]);

  useEffect(() => {
    if (!enabled || !supabase || menuBi.needsAuth || !filters?.liveMode) return undefined;
    const pollActive = async () => {
      try {
        const liveRes = await supabase.rpc("get_live_activity");
        if (liveRes?.error || liveRes?.data == null) {
          setActiveGuestsStatus((prev) => (prev === "success" ? "stale" : "unavailable"));
          return;
        }
        setActiveGuestsNow(Number(liveRes.data.active_sessions) || 0);
        setActiveGuestsStatus("success");
      } catch {
        setActiveGuestsStatus((prev) => (prev === "success" ? "stale" : "unavailable"));
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
    activeGuestsStatus,
    enrichError,
    enrichLoading,
    reload,
    // Block only when we have nothing to paint; enrichment refreshes quietly.
    loading: Boolean(menuBi.loading && !data),
    refreshing: Boolean(menuBi.refreshing || enrichLoading || (menuBi.loading && data)),
    error: menuBi.error || enrichError || "",
  };
}
