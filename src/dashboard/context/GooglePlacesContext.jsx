import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchBranchGooglePlaceMetrics } from "../services/googlePlacesService";
import { upsertTodayGoogleReviewSnapshots } from "../utils/googleReviewSnapshotHistory";

const GooglePlacesContext = createContext(null);

function apiKeyPresent() {
  return Boolean((process.env.REACT_APP_GOOGLE_API_KEY || "").trim());
}

export function GooglePlacesProvider({ children, enabled = true, branchIds = null }) {
  const [loading, setLoading] = useState(Boolean(enabled));
  const [byBranch, setByBranch] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const settleTimer = setTimeout(() => {
      if (cancelled) return;
      setError((prev) => prev || "timed_out");
      setLoading(false);
    }, 8000);

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const targets = Array.isArray(branchIds) && branchIds.length ? branchIds : null;
        const data = targets
          ? Object.assign(
              {},
              ...(await Promise.all(targets.map((id) => fetchBranchGooglePlaceMetrics(id)))),
            )
          : await fetchBranchGooglePlaceMetrics(null);
        if (cancelled) return;
        setByBranch(data);
        upsertTodayGoogleReviewSnapshots(data).catch(() => {});
        const failed = Object.values(data).every((m) => m?.rating == null);
        if (failed && !apiKeyPresent()) {
          setError("missing_api_key");
        } else if (failed) {
          setError("unavailable");
        }
      } catch {
        if (!cancelled) {
          setByBranch({});
          setError("fetch_error");
        }
      } finally {
        clearTimeout(settleTimer);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(settleTimer);
    };
  }, [enabled, branchIds]);

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
