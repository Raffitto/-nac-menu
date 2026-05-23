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
import {
  resolveMenuPlatformStatus,
  PLATFORM_STATUS,
} from "../../platform/engines/platformStatusEngine";
import { rangeContractFromFilters } from "../../platform/engines/timeRangeEngine";

const EMPTY_CONTRACT = {
  data: null,
  loading: false,
  needsAuth: false,
  liveFallback: false,
  showFallbackBanner: false,
  menuDataEmpty: true,
  partial: false,
  note: null,
  opsNotes: [],
  error: "",
  platformStatus: null,
  rangeContract: null,
  hours: 24,
  selectedRange: "today",
  sparseHistory: false,
  reload: () => {},
};

/**
 * Canonical BI loader — all menu_events / get_bi_dashboard consumers should use this hook or MenuBiDashboardProvider.
 *
 * @param {object} [options]
 * @param {boolean} [options.enabled=true]
 * @param {number} [options.refreshIntervalMs=0] Auto-refresh interval (live mode).
 * @param {string} [options.source] Diagnostics label.
 */
export function useMenuBiDashboard(options = {}) {
  const { enabled = true, refreshIntervalMs = 0, source = "useMenuBiDashboard" } = options;
  const filters = usePlatformFiltersOptional();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [liveFallback, setLiveFallback] = useState(false);
  const [menuDataEmpty, setMenuDataEmpty] = useState(false);
  const [partial, setPartial] = useState(false);
  const [note, setNote] = useState(null);
  const [opsNotes, setOpsNotes] = useState([]);
  const [error, setError] = useState("");

  const rangeContract = useMemo(
    () => rangeContractFromFilters(filters || {}),
    [filters],
  );
  const hours = filters?.timeRangeHours ?? rangeContract.hours;

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      setData(null);
      setNeedsAuth(false);
      setMenuDataEmpty(true);
      setError("Supabase not configured");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        setNeedsAuth(true);
        setData(null);
        setLiveFallback(false);
        setMenuDataEmpty(true);
        setOpsNotes([]);
        setNote(null);
        setPartial(false);
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
      setOpsNotes(result?.opsNotes || []);
      setLiveFallback(Boolean(result?.liveFallback));
      setMenuDataEmpty(Boolean(result?.menuDataEmpty ?? isMenuBiFullyEmpty(normalized)));
      logBiIntelligenceDiagnostics({
        source,
        biData: normalized,
        hours,
        selectedRange: filters?.selectedRange || "today",
        liveFallback: result?.liveFallback,
        partial: result?.partial,
      });
    } catch (e) {
      setData(null);
      setLiveFallback(false);
      setMenuDataEmpty(true);
      setOpsNotes([]);
      setError(e?.message || "Failed to load menu intelligence");
    } finally {
      setLoading(false);
    }
  }, [enabled, filters?.branch, filters?.selectedRange, hours, source]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled || !refreshIntervalMs || refreshIntervalMs < 5000) return undefined;
    const id = setInterval(load, refreshIntervalMs);
    return () => clearInterval(id);
  }, [enabled, refreshIntervalMs, load]);

  const platformStatus = useMemo(
    () =>
      resolveMenuPlatformStatus({
        data,
        partial,
        liveFallback,
        note,
        opsNotes,
        menuDataEmpty,
        selectedRange: filters?.selectedRange || "today",
      }),
    [data, partial, liveFallback, note, opsNotes, menuDataEmpty, filters?.selectedRange],
  );

  const sparseHistory =
    platformStatus?.status === PLATFORM_STATUS.SPARSE_HISTORY ||
    platformStatus?.status === PLATFORM_STATUS.BASELINE_BUILDING;

  if (!enabled) {
    return { ...EMPTY_CONTRACT, rangeContract, reload: load };
  }

  return {
    data,
    loading,
    needsAuth,
    liveFallback,
    showFallbackBanner: shouldShowLiveFallbackBanner(liveFallback),
    menuDataEmpty,
    partial,
    note,
    opsNotes,
    error,
    platformStatus,
    rangeContract,
    sparseHistory,
    fallback: {
      partial,
      liveFallback,
      note,
      opsNotes,
    },
    reload: load,
    hours,
    selectedRange: filters?.selectedRange || "today",
  };
}
