import React, { useMemo } from "react";
import { Database, Info } from "lucide-react";
import { buildAnalyticsIntegrityMeta } from "../../lib/unifiedOperationalTruth";

/**
 * Shared scope / integrity language for all analytics surfaces.
 */
export default function AnalyticsIntegrityStrip({
  data = null,
  truth = null,
  operationalTrust = null,
  foodics = null,
  surface = "analytics",
  className = "",
}) {
  const meta = useMemo(
    () =>
      buildAnalyticsIntegrityMeta({
        data,
        truth,
        operationalTrust,
        foodics,
        surface,
      }),
    [data, truth, operationalTrust, foodics, surface],
  );

  if (!meta?.scopeLabels?.length) return null;

  return (
    <div className={`nac-analytics-integrity ${className}`.trim()} role="note">
      <div className="nac-analytics-integrity-head">
        <Database size={13} aria-hidden />
        <span>Operational scope</span>
        {meta.trust?.label ? (
          <span className="nac-analytics-integrity-trust">{meta.trust.label}</span>
        ) : null}
      </div>
      <ul className="nac-analytics-integrity-list">
        {meta.scopeLabels.map((line) => (
          <li key={line}>
            <Info size={11} aria-hidden />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
