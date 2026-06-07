import React, { useCallback, useMemo, useState } from "react";
import { FileText, Briefcase, List, FileJson, Table2 } from "lucide-react";
import {
  buildAskNacExportPayload,
  hasExportableContent,
  hasTabularKeyMetrics,
  EXPORT_FORMATS,
} from "./askNacExportPayload";
import { exportAskNacRawJson, exportAskNacRawCsv } from "./askNacCsvExport";
import {
  exportAskNacPdf,
  exportAskNacExecutiveReport,
  exportAskNacDetailedAnalysis,
} from "./askNacPdfExport";

const EXPORT_ACTIONS = [
  { id: EXPORT_FORMATS.PDF, label: "PDF", icon: FileText, title: "One-page answer report" },
  { id: EXPORT_FORMATS.EXECUTIVE, label: "Executive", icon: Briefcase, title: "CEO-ready brief" },
  { id: EXPORT_FORMATS.DETAILED, label: "Detailed", icon: List, title: "Full analysis with diagnostics" },
  { id: EXPORT_FORMATS.JSON, label: "JSON", icon: FileJson, title: "Structured response payload" },
  { id: EXPORT_FORMATS.CSV, label: "CSV", icon: Table2, title: "Key metrics table" },
];

/**
 * @param {{ question: string, response: object, filters?: object, onStatus?: (msg: string) => void }} props
 */
export default function AskNacExportButton({ question, response, filters = {}, onStatus }) {
  const [busy, setBusy] = useState(null);

  const canExport = useMemo(() => hasExportableContent(response), [response]);
  const payload = useMemo(
    () => (canExport ? buildAskNacExportPayload({ question, response, filters }) : null),
    [canExport, question, response, filters],
  );
  const csvAvailable = useMemo(() => hasTabularKeyMetrics(payload), [payload]);

  const notify = useCallback(
    (message) => {
      if (onStatus) onStatus(message);
    },
    [onStatus],
  );

  const runExport = useCallback(
    async (formatId) => {
      if (!payload || busy) return;
      setBusy(formatId);
      try {
        switch (formatId) {
          case EXPORT_FORMATS.PDF:
            exportAskNacPdf(payload);
            notify("PDF downloaded.");
            break;
          case EXPORT_FORMATS.EXECUTIVE:
            exportAskNacExecutiveReport(payload);
            notify("Executive report downloaded.");
            break;
          case EXPORT_FORMATS.DETAILED:
            exportAskNacDetailedAnalysis(payload);
            notify("Detailed analysis downloaded.");
            break;
          case EXPORT_FORMATS.JSON:
            exportAskNacRawJson(payload);
            notify("JSON exported.");
            break;
          case EXPORT_FORMATS.CSV:
            if (!csvAvailable) {
              notify("CSV unavailable — no tabular key metrics.");
              return;
            }
            exportAskNacRawCsv(payload);
            notify("CSV exported.");
            break;
          default:
            break;
        }
      } catch (err) {
        notify(err?.message || "Export failed.");
      } finally {
        setBusy(null);
      }
    },
    [payload, busy, csvAvailable, notify],
  );

  return (
    <div className="nac-ask-nac-export">
      <span className="nac-ask-nac-export__label">Export</span>
      <div className="nac-ask-nac-export__actions" role="group" aria-label="Export answer">
        {EXPORT_ACTIONS.map(({ id, label, icon: Icon, title }) => {
          const disabled =
            !canExport || Boolean(busy) || (id === EXPORT_FORMATS.CSV && !csvAvailable);
          return (
            <button
              key={id}
              type="button"
              className="nac-ask-nac-export__btn"
              title={title}
              disabled={disabled}
              aria-busy={busy === id}
              onClick={() => runExport(id)}
            >
              <Icon size={14} aria-hidden />
              <span>{busy === id ? "…" : label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
