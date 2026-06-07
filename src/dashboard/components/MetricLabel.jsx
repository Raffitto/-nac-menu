import React from "react";
import { Info } from "lucide-react";
import { getMetricLabel, getMetricTooltip } from "../../intelligence/metrics/metricDefinitions";

/**
 * Inline metric label with optional canonical tooltip (definitions layer only).
 */
export default function MetricLabel({
  metricId,
  variant = "label",
  showTooltip = true,
  className = "",
  as: Tag = "span",
  children,
}) {
  const text = children || getMetricLabel(metricId, variant);
  const tip = showTooltip ? getMetricTooltip(metricId) : "";

  if (!tip) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag className={`nac-metric-label ${className}`.trim()} title={tip}>
      {text}
      {showTooltip ? (
        <Info size={12} className="nac-metric-label-icon" aria-hidden />
      ) : null}
    </Tag>
  );
}
