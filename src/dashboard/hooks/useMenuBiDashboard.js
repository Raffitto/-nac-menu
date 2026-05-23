import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchBiDashboard } from "../../lib/intelligenceQueryApi";
import {
  isMenuBiFullyEmpty,
  normalizeBiDashboardPayload,
  shouldShowLiveFallbackBanner,
} from "../../lib/biDashboardNormalize";
import { rangeToHours } from "../utils/rangeState";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { logBiIntelligenceDiagnostics } from "../../lib/intelligenceDiagnostics";

/**
 * Shared BI loader for Menu Intelligence + Visual OS — same payload for Today / 7D / Month.
 */
export function useMenuBiDashboard() {
  const filters = usePlatformFiltersOptional();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [liveFallback, setLiveFallback] = useState(false);
  const [menuDataEmpty, setMenuDataEmpty] = useState(false);
  const [partial, setPartial] = useState(false);
  const [note, setNote] = useState(null);

  const hours = filters?.timeRangeHours ?? rangeToHours(filters?.selectedRange || "today");

  const load = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      setData(null);
      setNeedsAuth(false);
      setMenuDataEmpty(true);
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        setNeedsAuth(true);
        setData(null);
        setLiveFallback(false);
        setMenuDataEmpty(true);
        return;
      }

      setNeedsAuth(false);
      const result = await fetchBiDashboard(supabase, {
        branch: filters?.branch || null,
        hours,
      });

      const normalized = normalizeBiDashboardPayload(result?.data);
      setData(normalized);
      setPartial(Boolean(result?.partial));
      setNote(result?.note || null);
      setLiveFallback(Boolean(result?.liveFallback));
      setMenuDataEmpty(isMenuBiFullyEmpty(normalized));
      logBiIntelligenceDiagnostics({
        source: "useMenuBiDashboard",
        biData: normalized,
        hours,
        selectedRange: filters?.selectedRange || "today",
        liveFallback: result?.liveFallback,
        partial: result?.partial,
      });
    } catch {
      setData(null);
      setLiveFallback(false);
      setMenuDataEmpty(true);
    } finally {
      setLoading(false);
    }
  }, [filters?.branch, filters?.selectedRange, hours]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    data,
    loading,
    needsAuth,
    liveFallback,
    showFallbackBanner: shouldShowLiveFallbackBanner(liveFallback),
    menuDataEmpty,
    partial,
    note,
    reload: load,
    hours,
    selectedRange: filters?.selectedRange || "today",
  };
}
