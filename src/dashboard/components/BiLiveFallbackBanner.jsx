import React from "react";
import { resolveIntelligenceStatusBanner } from "../../intelligence/metrics/metricDefinitions";

/**
 * Subtle notice when primary RPC was empty but menu_events fallback supplied data.
 */
export default function BiLiveFallbackBanner({ visible }) {
  if (!visible) return null;

  const banner = resolveIntelligenceStatusBanner({ liveFallback: true });
  return (
    <p className="nac-bi-live-fallback" role="status">
      {banner?.message || "Live fallback active"}
    </p>
  );
}
