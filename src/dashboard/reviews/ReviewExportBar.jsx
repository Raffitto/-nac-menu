import React from "react";
import { Download, FileText, FileDown, Users } from "lucide-react";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useReviewExports } from "./useReviewExports";

/**
 * Unified Review Intelligence exports — snapshot PNG vs operational PDFs.
 */
export default function ReviewExportBar({ snapshotRef }) {
  const filters = usePlatformFiltersOptional();
  const {
    configured,
    exportSnapshotPng,
    exportBranchAuditPdf,
    exportSummaryPdf,
    exportSummaryXlsx,
    busy,
  } = useReviewExports(filters);

  if (!configured) return null;

  return (
    <div className="rev-export-zone" role="region" aria-label="Review exports">
      <div className="rev-export-zone-head">
        <h3 className="rev-export-zone-title">Exports</h3>
        <p className="rev-export-zone-sub">
          Snapshot PNG is for sharing only. Branch audit PDF is the full operational staff report (Khobar, Riyadh, Jeddah).
        </p>
      </div>
      <div className="rev-export-zone-actions">
        <button
          type="button"
          className="rev-export-btn"
          onClick={() => exportSnapshotPng(snapshotRef?.current)}
          disabled={busy.png || !snapshotRef?.current}
          title="Small shareable card — WhatsApp-friendly PNG"
        >
          <Download size={14} className={busy.png ? "nac-bi-spin" : ""} />
          {busy.png ? "Exporting…" : "Snapshot PNG"}
        </button>
        <button
          type="button"
          className="rev-export-btn rev-export-btn--audit"
          onClick={exportBranchAuditPdf}
          disabled={busy.audit}
          title="Detailed Branch Operational Review — one page per branch, all staff"
        >
          <Users size={14} className={busy.audit ? "nac-bi-spin" : ""} />
          {busy.audit ? "Building…" : "Branch audit PDF"}
        </button>
        <button
          type="button"
          className="rev-export-btn"
          onClick={exportSummaryPdf}
          disabled={busy.summary}
          title="Summary review intelligence PDF for current filters"
        >
          <FileText size={14} />
          Summary PDF
        </button>
        <button
          type="button"
          className="rev-export-btn"
          onClick={exportSummaryXlsx}
          disabled={busy.summary}
          title="Summary spreadsheet for current filters"
        >
          <FileDown size={14} />
          XLSX
        </button>
      </div>
    </div>
  );
}
