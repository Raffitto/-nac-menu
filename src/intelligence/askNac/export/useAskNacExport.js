import { useCallback, useMemo, useState } from "react";
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
import { exportWeeklyDashboardXlsx } from "./weeklyDashboardXlsxExport";

export const ASK_NAC_EXPORT_ACTIONS = [
  { id: EXPORT_FORMATS.WEEKLY_DASHBOARD_XLSX, label: "XLSX", title: "Weekly management dashboard workbook" },
  { id: EXPORT_FORMATS.PDF, label: "PDF", title: "One-page answer report" },
  { id: EXPORT_FORMATS.EXECUTIVE, label: "Executive", title: "CEO-ready brief" },
  { id: EXPORT_FORMATS.DETAILED, label: "Detailed", title: "Full analysis with diagnostics" },
  { id: EXPORT_FORMATS.JSON, label: "JSON", title: "Structured response payload" },
  { id: EXPORT_FORMATS.CSV, label: "CSV", title: "Key metrics table" },
];

export function useAskNacExport({ question, response, filters = {}, onStatus }) {
  const [busy, setBusy] = useState(null);

  const canExport = useMemo(() => hasExportableContent(response), [response]);
  const weeklyDashboardAvailable = useMemo(
    () => Boolean(response?.weeklyDashboardPackage?.meta),
    [response],
  );
  const payload = useMemo(
    () => (canExport ? buildAskNacExportPayload({ question, response, filters }) : null),
    [canExport, question, response, filters],
  );
  const csvAvailable = useMemo(() => hasTabularKeyMetrics(payload), [payload]);

  const notify = useCallback(
    (message) => {
      onStatus?.(message);
    },
    [onStatus],
  );

  const runExport = useCallback(
    async (formatId) => {
      if (!payload || busy) return;
      setBusy(formatId);
      try {
        switch (formatId) {
          case EXPORT_FORMATS.WEEKLY_DASHBOARD_XLSX:
            if (!response?.weeklyDashboardPackage) {
              notify("Weekly dashboard XLSX unavailable.");
              return;
            }
            exportWeeklyDashboardXlsx(response.weeklyDashboardPackage);
            notify("Weekly dashboard XLSX downloaded.");
            break;
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
    [payload, busy, csvAvailable, notify, response],
  );

  const isDisabled = useCallback(
    (formatId) => {
      if (!canExport || Boolean(busy)) return true;
      if (formatId === EXPORT_FORMATS.WEEKLY_DASHBOARD_XLSX) return !weeklyDashboardAvailable;
      if (formatId === EXPORT_FORMATS.CSV) return !csvAvailable;
      return false;
    },
    [busy, canExport, csvAvailable, weeklyDashboardAvailable],
  );

  const visibleActions = useMemo(
    () => ASK_NAC_EXPORT_ACTIONS.filter((action) => {
      if (action.id === EXPORT_FORMATS.WEEKLY_DASHBOARD_XLSX) return weeklyDashboardAvailable;
      return true;
    }),
    [weeklyDashboardAvailable],
  );

  return {
    busy,
    canExport,
    csvAvailable,
    weeklyDashboardAvailable,
    visibleActions,
    runExport,
    isDisabled,
  };
}
