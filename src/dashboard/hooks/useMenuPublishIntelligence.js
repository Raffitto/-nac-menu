import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCurrentBranchSnapshot,
  fetchLatestLivePublication,
  listMenuPublications,
} from "../../lib/menuApi";
import { diffMenuSnapshots } from "../../lib/menuPublishDiff";

/**
 * Loads last live publication + current draft snapshot and memoizes the structured diff.
 * Expensive fetch runs on branch change / explicit refresh — not per card render.
 */
export default function useMenuPublishIntelligence({
  branchId,
  enabled = true,
  publishStatus = null,
}) {
  const [livePublication, setLivePublication] = useState(null);
  const [draftSnapshot, setDraftSnapshot] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !branchId) return null;
    const req = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const [liveRes, draftRes, histRes] = await Promise.all([
        fetchLatestLivePublication(branchId),
        fetchCurrentBranchSnapshot(branchId),
        listMenuPublications(branchId, { limit: 40 }),
      ]);
      if (req !== requestRef.current) return null;
      if (liveRes.error) throw liveRes.error;
      if (draftRes.error) throw draftRes.error;
      if (histRes.error) throw histRes.error;
      setLivePublication(liveRes.data);
      setDraftSnapshot(draftRes.data);
      setHistory(histRes.data || []);
      return {
        livePublication: liveRes.data,
        draftSnapshot: draftRes.data,
        history: histRes.data || [],
      };
    } catch (err) {
      if (req !== requestRef.current) return null;
      setError(err?.message || "Could not load publish intelligence");
      return null;
    } finally {
      if (req === requestRef.current) setLoading(false);
    }
  }, [branchId, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (publishStatus?.sync_status === "needs_publish") {
      refresh();
    }
  }, [enabled, publishStatus?.sync_status, publishStatus?.current_fingerprint, refresh]);

  const diff = useMemo(() => {
    if (!draftSnapshot) {
      return {
        hasChanges: false,
        counts: { total: 0 },
        changes: [],
        changedItemIds: [],
        newItemIds: [],
        removedItemIds: [],
        changesBySectionId: {},
        changesByCategoryId: {},
        risk: {},
      };
    }
    return diffMenuSnapshots(livePublication?.snapshot || null, draftSnapshot);
  }, [livePublication, draftSnapshot]);

  return {
    livePublication,
    draftSnapshot,
    history,
    diff,
    loading,
    error,
    refresh,
  };
}
