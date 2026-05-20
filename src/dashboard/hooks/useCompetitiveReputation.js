import { useCallback, useEffect, useState } from "react";
import {
  buildBranchCompetitiveIntel,
  buildNetworkCompetitiveIntel,
} from "../engines/competitiveReputationEngine";

/**
 * Load competitive reputation intelligence (all branches or one).
 * @param {string|null} branchId
 */
export function useCompetitiveReputation(branchId = null) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (branchId) {
        const branch = await buildBranchCompetitiveIntel(branchId);
        setData({ branches: [branch], networkNarrative: null, fetchedAt: branch.fetchedAt });
      } else {
        setData(await buildNetworkCompetitiveIntel());
      }
    } catch (e) {
      setData(null);
      setError(e?.message || "Failed to load competitive intelligence");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  return { loading, data, error, refresh: load };
}
