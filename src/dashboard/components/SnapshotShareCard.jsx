import React, { forwardRef } from "react";
import { Download, Share2 } from "lucide-react";
import { exportElementToPng } from "../utils/snapshotExport";
import { branchDisplayName, rangeExportLabel } from "../utils/rangeState";

/**
 * Luxury share card — export as PNG (WhatsApp-friendly 4:5).
 * When showActions=false, use ReviewExportBar for Snapshot PNG.
 */
const SnapshotShareCard = forwardRef(function SnapshotShareCard(
  {
    title = "Weekly performance",
    subtitle,
    branch,
    range = "7d",
    metrics = [],
    highlight,
    footer = "NAC HOSPITALITY OS",
    showActions = true,
  },
  ref,
) {
  const handleExport = async () => {
    const el = ref?.current;
    if (!el) return;
    const safeBranch = (branch || "network").toString().toLowerCase();
    await exportElementToPng(el, `nac-${safeBranch}-${range}-snapshot-${Date.now()}.png`);
  };

  return (
    <div className="nac-snapshot-wrap">
      {showActions && (
        <div className="nac-snapshot-actions">
          <button type="button" className="nac-filter-action" onClick={handleExport}>
            <Download size={14} />
            Snapshot PNG
          </button>
          <button
            type="button"
            className="nac-filter-action"
            onClick={handleExport}
            title="Download to share"
          >
            <Share2 size={14} />
            Share
          </button>
        </div>
      )}

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
            <div
              key={m.label}
              className={`nac-snapshot-metric${m.accent ? ` nac-snapshot-metric--${m.accent}` : ""}`}
            >
              <span>{m.label}</span>
              <strong>{m.value}</strong>
              {m.delta ? <em className="nac-snapshot-metric-delta">{m.delta}</em> : null}
            </div>
          ))}
        </div>
        <p className="nac-snapshot-footer">{footer}</p>
      </div>
    </div>
  );
});

export default SnapshotShareCard;
