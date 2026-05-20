import { useMemo } from "react";
import { useGooglePlacesContext } from "../context/GooglePlacesContext";
import { fetchBranchGooglePlaceMetrics } from "../services/googlePlacesService";
import { useEffect, useState } from "react";

function apiKeyPresent() {
  return Boolean((process.env.REACT_APP_GOOGLE_API_KEY || "").trim());
}

/**
 * Google Places metrics — shared via GooglePlacesProvider when inside Intelligence hub.
 */
export function useGooglePlaceMetrics(branchId = null) {
  const shared = useGooglePlacesContext();
  const branchKey = branchId ? String(branchId).toLowerCase() : null;

  const [loading, setLoading] = useState(!shared);
  const [byBranch, setByBranch] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    if (shared) return undefined;

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchBranchGooglePlaceMetrics(null);
        if (!cancelled) {
          setByBranch(data);
          const failed = Object.values(data).every((m) => m?.rating == null);
          if (failed && !apiKeyPresent()) {
            setError("missing_api_key");
          } else if (failed) {
            setError("unavailable");
          }
        }
      } catch {
        if (!cancelled) {
          setByBranch({});
          setError("fetch_error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shared]);

  const resolvedLoading = shared ? shared.loading : loading;
  const resolvedByBranch = shared ? shared.byBranch : byBranch;
  const resolvedError = shared ? shared.error : error;

  const forBranch = useMemo(() => {
    if (!branchKey) return null;
    return resolvedByBranch[branchKey] || null;
  }, [resolvedByBranch, branchKey]);

  return {
    loading: resolvedLoading,
    byBranch: resolvedByBranch,
    forBranch,
    error: resolvedError,
  };
}
