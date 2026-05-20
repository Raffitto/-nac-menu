import { useEffect, useState, useMemo } from "react";
import { fetchBranchGooglePlaceMetrics } from "../services/googlePlacesService";

/**
 * Load Google Places reputation metrics for all configured branches.
 * @param {string|null} branchId — optional; exposes `forBranch` for the active branch
 */
export function useGooglePlaceMetrics(branchId = null) {
  const [loading, setLoading] = useState(true);
  const [byBranch, setByBranch] = useState({});
  const [error, setError] = useState(null);

  const branchKey = branchId ? String(branchId).toLowerCase() : null;

  useEffect(() => {
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
      } catch (e) {
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
  }, []);

  const forBranch = useMemo(() => {
    if (!branchKey) return null;
    return byBranch[branchKey] || null;
  }, [byBranch, branchKey]);

  return { loading, byBranch, forBranch, error };
}

function apiKeyPresent() {
  return Boolean((process.env.REACT_APP_GOOGLE_API_KEY || "").trim());
}
