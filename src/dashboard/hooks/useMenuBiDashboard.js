import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchUnifiedOperationalTruth } from "../../lib/unifiedOperationalTruth";
import {
  isMenuBiFullyEmpty,
  normalizeBiDashboardPayload,
  shouldShowLiveFallbackBanner,
} from "../../lib/biDashboardNormalize";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useRbacOptional } from "../context/RbacContext";
import { resolveRbacQueryBranch } from "../../lib/rbacQueryScope";
import { logBiIntelligenceDiagnostics } from "../../lib/intelligenceDiagnostics";
import {
  resolveMenuPlatformStatus,
  PLATFORM_STATUS,
} from "../../platform/engines/platformStatusEngine";
import { rangeContractFromFilters } from "../../platform/engines/timeRangeEngine";
import { assessMenuBiSufficiency } from "../../platform/contracts/dataSufficiency";
import { recordPipelineFetch } from "../../lib/pipelineDiagnostics";
import { isNacDebugEnabled } from "../../lib/nacDebug";
import { probeLatestEventTimestamps } from "../../platform/engines/dataFreshnessEngine";
import { buildAndPublishTruthValidation } from "../../lib/truthValidationRegistry";
import { getMenuTrackingDiagnostics } from "../../lib/menuTrackingDiagnostics";
import { getPipelineDiagnostics } from "../../lib/pipelineDiagnostics";

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
  truthValidation: null,
  menuConfidence: null,
  operationalTrust: null,
  truth: null,
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
  const rbac = useRbacOptional();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [liveFallback, setLiveFallback] = useState(false);
  const [menuDataEmpty, setMenuDataEmpty] = useState(false);
  const [partial, setPartial] = useState(false);
  const [note, setNote] = useState(null);
  const [opsNotes, setOpsNotes] = useState([]);
  const [error, setError] = useState("");
  const [truthValidation, setTruthValidation] = useState(null);
  const [operationalTrust, setOperationalTrust] = useState(null);
  const [truth, setTruth] = useState(null);

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
      const effectiveBranch = resolveRbacQueryBranch(rbac?.profile, filters?.branch || null);
      const result = await fetchUnifiedOperationalTruth(supabase, {
        ...(filters || {}),
        branch: effectiveBranch,
        timeRangeHours: hours,
      });

      const normalized = result?.data || normalizeBiDashboardPayload(result?.data, { hours });
      setData(normalized);
      setTruth(result?.truth || normalized?._truth || null);
      setPartial(Boolean(result?.partial));
      setNote(result?.note || null);
      setOpsNotes(result?.opsNotes || []);
      setLiveFallback(Boolean(result?.liveFallback));
      setMenuDataEmpty(Boolean(result?.menuDataEmpty ?? isMenuBiFullyEmpty(normalized)));
      setOperationalTrust(result?.operationalTrust || null);
      await probeLatestEventTimestamps(supabase).catch(() => {});

      const sufficiency =
        result?.sufficiency || assessMenuBiSufficiency(normalized, rangeContract);

      const truthPkg = buildAndPublishTruthValidation({
        biData: normalized,
        rangeContract,
        dataSource: result?.dataSource,
        liveFallback: result?.liveFallback,
        partial: result?.partial,
        sufficiency,
        tracking: getMenuTrackingDiagnostics(),
        fetchHistory: getPipelineDiagnostics().fetchHistory,
      });
      setTruthValidation(truthPkg);

      logBiIntelligenceDiagnostics({
        source,
        biData: normalized,
        hours,
        selectedRange: filters?.selectedRange || "today",
        liveFallback: result?.liveFallback,
        partial: result?.partial,
        dataSource: result?.dataSource,
        healthScore: truthPkg?.healthScore?.score,
        menuConfidence: truthPkg?.menuConfidence?.level,
      });
    } catch (e) {
      setData(null);
      setLiveFallback(false);
      setMenuDataEmpty(true);
      setOpsNotes([]);
      setTruthValidation(null);
      setOperationalTrust(null);
      setTruth(null);
      setError(e?.message || "Failed to load menu intelligence");
    } finally {
      setLoading(false);
    }
  }, [enabled, filters, hours, source, rangeContract, rbac?.profile]);

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

  const dataSufficiency = useMemo(
    () => assessMenuBiSufficiency(data, rangeContract),
    [data, rangeContract],
  );

  useEffect(() => {
    if (!isNacDebugEnabled() || !platformStatus) return;
    recordPipelineFetch({ platformStatus: platformStatus.status });
  }, [platformStatus]);

  const sparseHistory =
    platformStatus?.status === PLATFORM_STATUS.SPARSE_HISTORY ||
    platformStatus?.status === PLATFORM_STATUS.BASELINE_BUILDING ||
    dataSufficiency.sparse;

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
    dataSufficiency,
    dataSource: data?.data_source || null,
    truthValidation,
    menuConfidence: truthValidation?.menuConfidence || null,
    healthScore: truthValidation?.healthScore || null,
    freshness: truthValidation?.freshness || null,
    operationalTrust,
    truth,
  };
}
