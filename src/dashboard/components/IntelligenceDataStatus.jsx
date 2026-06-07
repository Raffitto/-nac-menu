import React, { useMemo } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useMenuBiDashboardContextOptional } from "../context/MenuBiDashboardContext";
import { resolveIntelligenceStatusBanner } from "../../intelligence/metrics/metricDefinitions";

/**
 * Shared Intelligence status strip — updating / partial / live fallback (copy only).
 */
export default function IntelligenceDataStatus({ className = "" }) {
  const ctx = useMenuBiDashboardContextOptional();
  const banner = useMemo(() => {
    if (!ctx) return null;
    return resolveIntelligenceStatusBanner({
      loading: ctx.loading,
      hasExistingData: Boolean(ctx.data),
      partial: ctx.partial,
      liveFallback: ctx.liveFallback,
      operationalTrust: ctx.operationalTrust,
      note: ctx.note,
    });
  }, [ctx]);

  if (!banner) return null;

  const isUpdating = banner.kind === "updating";
  const Icon = isUpdating ? RefreshCw : AlertTriangle;

  return (
    <div
      className={`nac-intelligence-data-status nac-intelligence-data-status--${banner.kind} ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <Icon size={14} className={isUpdating ? "nac-bi-spin" : undefined} aria-hidden />
      <span>{banner.message}</span>
    </div>
  );
}
