import React, { useEffect, useState } from "react";
import { isNacDebugEnabled } from "../../lib/nacDebug";
import { getTruthValidation } from "../../lib/truthValidationRegistry";
import { CONFIDENCE_LABELS } from "../../platform/contracts/dataConfidence";

/**
 * Hidden analytics integrity panel — `window.NAC_DEBUG = true`.
 * Record floor observations: `NAC_RECORD_OBSERVATION({ qr_scans_30min: 5 })`
 */
export default function AnalyticsIntegrityPanel() {
  const [pkg, setPkg] = useState(null);

  useEffect(() => {
    if (!isNacDebugEnabled()) return undefined;
    const tick = () => setPkg(getTruthValidation());
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  if (!isNacDebugEnabled() || !pkg) return null;

  const h = pkg.healthScore || {};
  const integ = pkg.integrity || {};
  const fresh = pkg.freshness || {};
  const checklist = pkg.checklist || {};
  const anomalies = pkg.anomalies?.anomalies || [];

  return (
    <div
      className="nac-integrity-panel"
      style={{
        position: "fixed",
        bottom: 8,
        left: 8,
        zIndex: 99998,
        maxWidth: 420,
        maxHeight: "50vh",
        overflow: "auto",
        background: "rgba(12,10,18,0.94)",
        color: "#e3d4b8",
        fontFamily: "ui-monospace, monospace",
        fontSize: 10,
        lineHeight: 1.4,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid rgba(215,188,138,0.35)",
      }}
      aria-hidden
    >
      <strong style={{ color: "#d7bc8a" }}>Analytics integrity</strong>
      <div style={{ marginTop: 6 }}>
        Health <strong>{h.score ?? "—"}</strong> ({h.tier || "—"}) · Trust{" "}
        <strong>{pkg.operationalTrust?.score ?? "—"}</strong> ({pkg.operationalTrust?.tier || "—"}) · Menu conf{" "}
        {CONFIDENCE_LABELS[pkg.menuConfidence?.level] || pkg.menuConfidence?.level || "—"}
      </div>

      <div style={{ marginTop: 8, opacity: 0.9 }}>
        <div>Freshness (Riyadh)</div>
        <div>RPC: {fresh.last_rpc_refresh_label}</div>
        <div>Rollup: {fresh.last_rollup_refresh_label}</div>
        <div>Menu event: {fresh.last_menu_event_label}</div>
        <div>Review event: {fresh.last_review_event_label}</div>
        <div>Client track: {fresh.last_client_track_label}</div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div>Integrity</div>
        <div>Track fail %: {integ.missing_event_ratio_pct ?? "—"}</div>
        <div>Hour buckets filled: {integ.populated_hour_buckets}/{integ.expected_hour_buckets}</div>
        <div>Source: {integ.data_source || "—"} · Fallback: {String(integ.rpc_vs_fallback_divergence)}</div>
        <div>Review/menu: {integ.review_menu_sync}</div>
        <div>Branch imbalance: {String(integ.branch_imbalance)}</div>
      </div>

      {anomalies.length > 0 ? (
        <div style={{ marginTop: 8, color: "#ffb74d" }}>
          <div>Anomalies ({anomalies.length})</div>
          {anomalies.slice(0, 4).map((a) => (
            <div key={a.type}>• [{a.severity}] {a.message}</div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 8 }}>
        <div>
          Validation checklist
          {checklist.alignment_pct != null ? ` — ${checklist.alignment_pct}% aligned` : ""}
        </div>
        {(checklist.items || []).map((item) => (
          <div key={item.id} style={{ opacity: item.status === "pending" ? 0.6 : 1 }}>
            [{item.status}] {item.label}: obs {item.observed ?? "—"} / dash {item.expected ?? "—"}
          </div>
        ))}
      </div>
    </div>
  );
}
