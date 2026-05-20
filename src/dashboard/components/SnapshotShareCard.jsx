import React, { useRef, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { exportElementToPng } from "../utils/snapshotExport";
import { branchDisplayName, rangeExportLabel } from "../utils/rangeState";

/**
 * Luxury share card — export as PNG (WhatsApp-friendly 4:5).
 */
export default function SnapshotShareCard({
  title = "Weekly performance",
  subtitle,
  branch,
  range = "7d",
  metrics = [],
  highlight,
  footer = "NAC HOSPITALITY OS",
}) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    if (!ref.current || busy) return;
    setBusy(true);
    try {
      const safeBranch = (branch || "network").toString().toLowerCase();
      await exportElementToPng(
        ref.current,
        `nac-${safeBranch}-${range}-${Date.now()}.png`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nac-snapshot-wrap">
      <div className="nac-snapshot-actions">
        <button type="button" className="nac-filter-action" onClick={handleExport} disabled={busy}>
          <Download size={14} />
          {busy ? "Exporting…" : "PNG"}
        </button>
        <button type="button" className="nac-filter-action" onClick={handleExport} disabled={busy} title="Download to share">
          <Share2 size={14} />
          Share
        </button>
      </div>

      <div ref={ref} className="nac-snapshot-card">
        <div className="nac-snapshot-glow" aria-hidden />
        <p className="nac-snapshot-brand">NAC HOSPITALITY OS</p>
        <h2 className="nac-snapshot-title">{title}</h2>
        <p className="nac-snapshot-sub">
          {subtitle ||
            `${branch ? branchDisplayName(branch) : "All branches"} · ${rangeExportLabel(range)}`}
        </p>
        {highlight && <p className="nac-snapshot-highlight">{highlight}</p>}
        <div className="nac-snapshot-metrics">
          {metrics.map((m) => (
            <div key={m.label} className="nac-snapshot-metric">
              <span>{m.label}</span>
              <strong>{m.value}</strong>
            </div>
          ))}
        </div>
        <p className="nac-snapshot-footer">{footer}</p>
      </div>
    </div>
  );
}
