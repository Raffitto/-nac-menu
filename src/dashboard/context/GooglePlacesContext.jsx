import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchBranchGooglePlaceMetrics } from "../services/googlePlacesService";
import {
  fetchGoogleReviewSnapshots,
  upsertTodayGoogleReviewSnapshots,
} from "../utils/googleReviewSnapshotHistory";
import { GOOGLE_PLACE_BRANCHES } from "../config/googleBranchPlaces";
import { branchDisplayName } from "../utils/rangeState";

const GooglePlacesContext = createContext(null);

function apiKeyPresent() {
  return Boolean((process.env.REACT_APP_GOOGLE_API_KEY || "").trim());
}

function snapshotsToMetrics(rows = [], targets) {
  const latest = {};
  for (const row of rows || []) {
    const id = String(row.branch_id || "").toLowerCase();
    if (!id) continue;
    if (targets && !targets.includes(id)) continue;
    const prev = latest[id];
    if (!prev || String(row.snapshot_date) > String(prev.snapshot_date)) {
      latest[id] = row;
    }
  }
  return Object.fromEntries(
    Object.entries(latest).map(([id, row]) => [
      id,
      {
        placeId: null,
        rating: row.rating != null ? Number(row.rating) : null,
        totalReviews: row.review_count != null ? Number(row.review_count) : null,
        displayName: row.branch_name || branchDisplayName(id),
        error: row.rating == null && row.review_count == null ? "no_snapshot" : null,
        lastUpdated: row.snapshot_date || row.captured_at || null,
        fromSnapshot: true,
      },
    ]),
  );
}

export function GooglePlacesProvider({ children, enabled = true, branchIds = null }) {
  const [loading, setLoading] = useState(Boolean(enabled));
  const [byBranch, setByBranch] = useState({});
  const [error, setError] = useState(null);
  const targetKey = Array.isArray(branchIds) && branchIds.length
    ? branchIds.map((id) => String(id).toLowerCase()).sort().join(",")
    : "all";

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const targets = targetKey === "all" ? null : targetKey.split(",");

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: snaps, error: snapErr } = await fetchGoogleReviewSnapshots(
          targets || GOOGLE_PLACE_BRANCHES,
        );
        if (cancelled) return;
        const fromSnaps = snapshotsToMetrics(snaps || [], targets);
        if (Object.keys(fromSnaps).length) {
          setByBranch(fromSnaps);
          setLoading(false);
        }

        const live = targets
          ? Object.assign(
              {},
              ...(await Promise.all(targets.map((id) => fetchBranchGooglePlaceMetrics(id)))),
            )
          : await fetchBranchGooglePlaceMetrics(null);
        if (cancelled) return;

        const merged = { ...fromSnaps };
        for (const [id, metrics] of Object.entries(live || {})) {
          if (metrics?.rating != null || metrics?.totalReviews != null) {
            merged[id] = { ...metrics, fromSnapshot: false, lastUpdated: new Date().toISOString() };
          } else if (!merged[id]) {
            merged[id] = {
              ...metrics,
              error: metrics?.error || (snapErr ? "no_snapshot" : "unavailable"),
            };
          }
        }
        setByBranch(merged);
        upsertTodayGoogleReviewSnapshots(live).catch(() => {});
        const failed = Object.values(merged).every((m) => m?.rating == null);
        if (failed && !apiKeyPresent() && !Object.keys(fromSnaps).length) {
          setError("missing_api_key");
        } else if (failed) {
          setError("unavailable");
        }
      } catch {
        if (!cancelled) {
          setError("fetch_error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, targetKey]);

  const value = useMemo(
    () => ({ loading, byBranch, error }),
    [loading, byBranch, error],
  );

  return (
    <GooglePlacesContext.Provider value={value}>{children}</GooglePlacesContext.Provider>
  );
}

export function useGooglePlacesContext() {
  return useContext(GooglePlacesContext);
}
