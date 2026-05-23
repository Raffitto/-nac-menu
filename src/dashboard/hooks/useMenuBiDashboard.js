import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchBiDashboard } from "../../lib/intelligenceQueryApi";
import {
  isMenuBiFullyEmpty,
  normalizeBiDashboardPayload,
  shouldShowLiveFallbackBanner,
} from "../../lib/biDashboardNormalize";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { logBiIntelligenceDiagnostics } from "../../lib/intelligenceDiagnostics";
import { resolveMenuPlatformStatus } from "../../platform/engines/platformStatusEngine";
import { rangeContractFromFilters } from "../../platform/engines/timeRangeEngine";

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

  const rangeContract = useMemo(
    () => rangeContractFromFilters(filters || {}),
    [filters],
  );
  const hours = filters?.timeRangeHours ?? rangeContract.hours;

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

  const platformStatus = useMemo(
    () =>
      resolveMenuPlatformStatus({
        data,
        partial,
        liveFallback,
        note,
        menuDataEmpty,
        selectedRange: filters?.selectedRange || "today",
      }),
    [data, partial, liveFallback, note, menuDataEmpty, filters?.selectedRange],
  );

  return {
    data,
    loading,
    needsAuth,
    liveFallback,
    showFallbackBanner: shouldShowLiveFallbackBanner(liveFallback),
    menuDataEmpty,
    partial,
    note,
    platformStatus,
    rangeContract,
    reload: load,
    hours,
    selectedRange: filters?.selectedRange || "today",
  };
}
