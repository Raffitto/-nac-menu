import React, { useState } from "react";
import { Download, FileText, FileDown, Users } from "lucide-react";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useReviewExports } from "./useReviewExports";
import ExportRangeModal from "./ExportRangeModal";

/**
 * Unified Review Intelligence exports — snapshot PNG vs operational PDFs.
 */
export default function ReviewExportBar({ snapshotRef }) {
  const filters = usePlatformFiltersOptional();
  const selectedRange = filters?.selectedRange || "today";
  const [pendingExport, setPendingExport] = useState(null);

  const {
    configured,
    exportSnapshotPng,
    exportBranchAuditPdf,
    exportSummaryPdf,
    exportSummaryXlsx,
    busy,
  } = useReviewExports(filters);

  const modalCopy = {
    audit: {
      title: "Branch audit PDF — date range",
      subtitle: "Khobar, Riyadh, and Jeddah staff reports for the selected period.",
    },
    pdf: {
      title: "Summary PDF — date range",
      subtitle: "Review intelligence summary for the current branch filter.",
    },
    xlsx: {
      title: "Summary XLSX — date range",
      subtitle: "Spreadsheet export for the current branch filter.",
    },
  };

  const handleExportConfirm = (exportRange) => {
    const kind = pendingExport;
    setPendingExport(null);
    if (kind === "audit") exportBranchAuditPdf(exportRange);
    else if (kind === "pdf") exportSummaryPdf(exportRange);
    else if (kind === "xlsx") exportSummaryXlsx(exportRange);
  };

  if (!configured) return null;

  const modal = pendingExport ? modalCopy[pendingExport] : null;

  return (
    <>
      <div className="rev-export-zone" role="region" aria-label="Review exports">
        <div className="rev-export-zone-head">
          <h3 className="rev-export-zone-title">Exports</h3>
          <p className="rev-export-zone-sub">
            Snapshot PNG uses the dashboard view. PDF and XLSX open a date range picker before
            generating.
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
            onClick={() => setPendingExport("audit")}
            disabled={busy.audit}
            title="Detailed Branch Operational Review — one page per branch, all staff"
          >
            <Users size={14} className={busy.audit ? "nac-bi-spin" : ""} />
            {busy.audit ? "Building…" : "Branch audit PDF"}
          </button>
          <button
            type="button"
            className="rev-export-btn"
            onClick={() => setPendingExport("pdf")}
            disabled={busy.summary}
            title="Summary review intelligence PDF"
          >
            <FileText size={14} />
            Summary PDF
          </button>
          <button
            type="button"
            className="rev-export-btn"
            onClick={() => setPendingExport("xlsx")}
            disabled={busy.summary}
            title="Summary spreadsheet"
          >
            <FileDown size={14} />
            XLSX
          </button>
        </div>
      </div>

      <ExportRangeModal
        open={!!pendingExport}
        title={modal?.title}
        subtitle={modal?.subtitle}
        dashboardRange={selectedRange}
        onConfirm={handleExportConfirm}
        onCancel={() => setPendingExport(null)}
      />
    </>
  );
}
