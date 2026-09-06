import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { rbacScopeCacheKey } from "../../lib/rbacIntelligenceScope";
import { logBiIntelligenceDiagnostics } from "../../lib/intelligenceDiagnostics";
import {
  resolveMenuPlatformStatus,
  PLATFORM_STATUS,
} from "../../platform/engines/platformStatusEngine";
import {
  rangeContractFromFilters,
  hoursFromPlatformFilters,
} from "../../platform/engines/timeRangeEngine";
import { assessMenuBiSufficiency } from "../../platform/contracts/dataSufficiency";
import { recordPipelineFetch } from "../../lib/pipelineDiagnostics";
import { isNacDebugEnabled } from "../../lib/nacDebug";
import { probeLatestEventTimestamps } from "../../platform/engines/dataFreshnessEngine";
import { buildAndPublishTruthValidation } from "../../lib/truthValidationRegistry";
import { applyOperationalIntegrityToPayload } from "../../lib/operationalMetricsIntegrity";
import { getMenuTrackingDiagnostics } from "../../lib/menuTrackingDiagnostics";
import { getPipelineDiagnostics } from "../../lib/pipelineDiagnostics";
import { markBoot } from "../../lib/bootTelemetry";
import {
  cacheKey,
  peekCachedIntelligence,
  setCachedIntelligence,
  invalidateIntelligenceCache,
} from "../utils/intelligenceCache";

const BI_TTL_MS = 90 * 1000;

function applyPackage(pkg, setters) {
  const {
    setData,
    setTruth,
    setPartial,
    setNote,
    setOpsNotes,
    setLiveFallback,
    setMenuDataEmpty,
    setOperationalTrust,
    setTruthValidation,
  } = setters;
  setData(pkg.normalized);
  setTruth(pkg.truth);
  setPartial(pkg.partial);
  setNote(pkg.note);
  setOpsNotes(pkg.opsNotes);
  setLiveFallback(pkg.liveFallback);
  setMenuDataEmpty(pkg.menuDataEmpty);
  setOperationalTrust(pkg.operationalTrust);
  setTruthValidation(pkg.truthValidation);
}

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
  const [refreshing, setRefreshing] = useState(false);
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
  const dataRef = useRef(null);
  dataRef.current = data;

  const rangeContract = useMemo(
    () => rangeContractFromFilters(filters || {}),
    [filters],
  );
  const hours = hoursFromPlatformFilters(filters || {});
  const setters = useMemo(
    () => ({
      setData,
      setTruth,
      setPartial,
      setNote,
      setOpsNotes,
      setLiveFallback,
      setMenuDataEmpty,
      setOperationalTrust,
      setTruthValidation,
    }),
    [],
  );

  const biCacheKey = useMemo(
    () =>
      cacheKey([
        "menu-bi",
        rbacScopeCacheKey(rbac?.profile),
        hours,
        filters?.selectedRange || "today",
        filters?.branch || "all",
      ]),
    [rbac?.profile, hours, filters?.selectedRange, filters?.branch],
  );

  const load = useCallback(
    async (opts = {}) => {
      const force = Boolean(opts?.force);
      if (!enabled) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (!supabase || !isSupabaseConfigured()) {
        setLoading(false);
        setRefreshing(false);
        setData(null);
        setNeedsAuth(false);
        setMenuDataEmpty(true);
        setError("Supabase not configured");
        return;
      }

      const cached = !force ? peekCachedIntelligence(biCacheKey) : null;
      if (cached?.normalized) {
        applyPackage(cached, setters);
        setNeedsAuth(false);
        setLoading(false);
        setRefreshing(true);
      } else if (!dataRef.current) {
        setLoading(true);
        setRefreshing(false);
      } else {
        // Keep previous paint while the new filter key resolves.
        setLoading(false);
        setRefreshing(true);
      }

      setError("");
      let settled = false;
      const settleTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        setLoading(false);
        setRefreshing(false);
        if (!dataRef.current) {
          setError((prev) => prev || "Overview timed out. Operational metrics did not finish loading.");
        }
      }, 12000);
      try {
        const sessionOk = Boolean(rbac?.session);
        if (!sessionOk) {
          markBoot("tier1_get_session_start");
          const { data: sessionData } = await supabase.auth.getSession();
          markBoot("tier1_get_session_done");
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
        }

        setNeedsAuth(false);
        if (force) invalidateIntelligenceCache(biCacheKey);

        const effectiveBranch = resolveRbacQueryBranch(rbac?.profile, filters?.branch || null);
        markBoot("tier1_fetch_start");

        const buildPkg = (result, { tier1Partial = false } = {}) => {
          const normalized = applyOperationalIntegrityToPayload(
            result?.data || normalizeBiDashboardPayload(result?.data, { hours }),
            { hours, branch: effectiveBranch },
          );
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
          return {
            normalized: { ...normalized, _tier1Partial: tier1Partial || undefined },
            truth: result?.truth || normalized?._truth || null,
            partial: Boolean(result?.partial || tier1Partial),
            note: result?.note || null,
            opsNotes: result?.opsNotes || [],
            liveFallback: Boolean(result?.liveFallback),
            menuDataEmpty: Boolean(result?.menuDataEmpty ?? isMenuBiFullyEmpty(normalized)),
            operationalTrust: result?.operationalTrust || null,
            truthValidation: truthPkg,
          };
        };

        const result = await fetchUnifiedOperationalTruth(
          supabase,
          {
            ...(filters || {}),
            branch: effectiveBranch,
            timeRangeHours: hours,
          },
          {
            deferClientPatches: true,
            onTier1Partial: (partial) => {
              // Paint KPI cards as soon as session analytics lands; keep refreshing for full BI.
              if (dataRef.current && !dataRef.current._tier1Partial && !force) return;
              markBoot("tier1_session_ready");
              const earlyPkg = buildPkg(partial, { tier1Partial: true });
              applyPackage(earlyPkg, setters);
              setLoading(false);
              setRefreshing(true);
            },
          },
        );

        markBoot("tier1_full_ready");

        const pkg = buildPkg(result, { tier1Partial: false });

        setCachedIntelligence(biCacheKey, pkg, BI_TTL_MS);
        applyPackage(pkg, setters);
        setError("");
        probeLatestEventTimestamps(supabase).catch(() => {});

        logBiIntelligenceDiagnostics({
          source,
          biData: pkg.normalized,
          hours,
          selectedRange: filters?.selectedRange || "today",
          liveFallback: result?.liveFallback,
          partial: result?.partial,
          dataSource: result?.dataSource,
          healthScore: pkg.truthValidation?.healthScore?.score,
          menuConfidence: pkg.truthValidation?.menuConfidence?.level,
        });
      } catch (e) {
        if (!dataRef.current && !cached?.normalized) {
          setData(null);
          setLiveFallback(false);
          setMenuDataEmpty(true);
          setOpsNotes([]);
          setTruthValidation(null);
          setOperationalTrust(null);
          setTruth(null);
        }
        setError(e?.message || "Failed to load menu intelligence");
      } finally {
        clearTimeout(settleTimer);
        settled = true;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      enabled,
      filters,
      hours,
      source,
      rangeContract,
      rbac?.profile,
      rbac?.session,
      biCacheKey,
      setters,
    ],
  );

  const reload = useCallback(() => load({ force: true }), [load]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled || !refreshIntervalMs || refreshIntervalMs < 5000) return undefined;
    const id = setInterval(() => load(), refreshIntervalMs);
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

  // Keep last payload when a keep-alive pane is inactive — do not wipe to EMPTY.
  if (!enabled) {
    return {
      data,
      loading: false,
      refreshing: false,
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
      fallback: { partial, liveFallback, note, opsNotes },
      reload,
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

  return {
    data,
    loading,
    refreshing,
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
    reload,
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
