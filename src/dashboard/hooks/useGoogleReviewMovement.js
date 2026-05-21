import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GOOGLE_PLACE_BRANCHES } from "../config/googleBranchPlaces";
import {
  buildAllBranchGoogleMovement,
  fetchGoogleReviewSnapshots,
  upsertTodayGoogleReviewSnapshots,
} from "../utils/googleReviewSnapshotHistory";
import { fetchBranchGooglePlaceMetrics } from "../services/googlePlacesService";

/**
 * Load snapshot history + optional capture from live Places metrics.
 */
export function useGoogleReviewMovement({
  byBranch = {},
  enabled = true,
  captureOnLoad = false,
  periodRange = "month",
} = {}) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [captureNote, setCaptureNote] = useState(null);
  const capturedOnceRef = useRef(false);

  const metricsFingerprint = useMemo(
    () =>
      GOOGLE_PLACE_BRANCHES.map(
        (b) => `${b}:${byBranch[b]?.totalReviews ?? "x"}:${byBranch[b]?.rating ?? "x"}`,
      ).join("|"),
    [byBranch],
  );

  const reload = useCallback(async () => {
    const { data, error } = await fetchGoogleReviewSnapshots();
    if (!error) setSnapshots(data);
    return { data, error };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        if (
          captureOnLoad &&
          !capturedOnceRef.current &&
          metricsFingerprint.includes(":") &&
          !metricsFingerprint.includes(":x:")
        ) {
          capturedOnceRef.current = true;
          const cap = await upsertTodayGoogleReviewSnapshots(byBranch);
          if (!cancelled && cap.skipped && cap.reason === "auth_required") {
            setCaptureNote("Sign in to save daily Google snapshots.");
          } else if (!cancelled && !cap.skipped && !cap.error) {
            setCaptureNote(null);
          }
        }
        const { data, error } = await fetchGoogleReviewSnapshots();
        if (!cancelled && !error) setSnapshots(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, captureOnLoad, metricsFingerprint, byBranch]);

  const movementByBranch = useMemo(() => {
    const reports = buildAllBranchGoogleMovement(snapshots, { periodRange });
    return Object.fromEntries(reports.map((r) => [r.branch_id, r]));
  }, [snapshots, periodRange]);

  const movementList = useMemo(
    () => buildAllBranchGoogleMovement(snapshots, { periodRange }),
    [snapshots, periodRange],
  );

  return {
    loading,
    snapshots,
    movementByBranch,
    movementList,
    captureNote,
    reload,
    captureToday: async (metricsByBranch) => {
      const source =
        Object.keys(metricsByBranch || {}).length > 0
          ? metricsByBranch
          : await fetchBranchGooglePlaceMetrics(null);
      const result = await upsertTodayGoogleReviewSnapshots(source);
      await reload();
      return result;
    },
  };
}
