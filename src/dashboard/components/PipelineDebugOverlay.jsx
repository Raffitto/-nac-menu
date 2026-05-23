import React, { useEffect, useState } from "react";
import { isNacDebugEnabled } from "../../lib/nacDebug";
import { getPipelineDiagnostics } from "../../lib/pipelineDiagnostics";

/**
 * Hidden diagnostics — enable with `window.NAC_DEBUG = true` then reload BI.
 */
export default function PipelineDebugOverlay() {
  const [snap, setSnap] = useState(null);

  useEffect(() => {
    if (!isNacDebugEnabled()) return undefined;
    const tick = () => setSnap(getPipelineDiagnostics());
    tick();
    const id = setInterval(tick, 2500);
    return () => clearInterval(id);
  }, []);

  if (!isNacDebugEnabled() || !snap?.lastFetch) return null;

  const lf = snap.rollupVsFallback || {};
  const tr = snap.tracking || {};

  return (
    <div
      className="nac-pipeline-debug"
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 99999,
        maxWidth: 360,
        maxHeight: "42vh",
        overflow: "auto",
        background: "rgba(10,12,18,0.92)",
        color: "#c8e6c9",
        fontFamily: "ui-monospace, monospace",
        fontSize: 10,
        lineHeight: 1.35,
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(129,199,132,0.35)",
        pointerEvents: "none",
      }}
      aria-hidden
    >
      <strong style={{ color: "#81c784" }}>NAC pipeline debug</strong>
      <div>source: {lf.dataSource || "—"}</div>
      <div>rpc: {lf.primaryRpc || "—"}</div>
      <div>live fallback: {String(lf.liveFallback)}</div>
      <div>rpc ms: {snap.rpcTimingsMs ?? "—"}</div>
      <div>events: {snap.lastFetch?.totalEvents ?? "—"}</div>
      <div>hour buckets: {snap.hourlyPopulatedBuckets ?? "—"}</div>
      <div>platform: {snap.platformStatus || "—"}</div>
      <div>track ok/fail: {tr.ok}/{tr.fail}</div>
      <div style={{ marginTop: 4, opacity: 0.85 }}>
        types:{" "}
        {Object.entries(tr.by_event_type || {})
          .slice(0, 8)
          .map(([k, v]) => `${k}:${v}`)
          .join(" ") || "—"}
      </div>
    </div>
  );
}
