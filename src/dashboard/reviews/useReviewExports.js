import { useState, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchReviewEventsSummary } from "../../lib/intelligenceQueryApi";
import {
  kpisFromReviewSummary,
  staffFromReviewSummary,
  branchComparisonFromReviewSummary,
} from "../utils/reviewSummaryMap";
import {
  OPERATIONAL_BRANCHES,
  buildBranchOperationalReport,
  buildBranchOperationalReportFromSummary,
} from "../engines/branchOperationalReviewEngine";
import { buildEmployeePerformance } from "../engines/employeePerformanceEngine";
import {
  aggregateStaffReviewStats,
  mergeStaffStats,
} from "../utils/staffReviewStats";
import {
  computeReviewKpis,
  buildBranchReviewComparison,
  runReviewDataQualityDiagnostics,
} from "../utils/reviewEventMetrics";
import { branchDisplayName, rangeExportLabel } from "../utils/rangeState";
import { resolveExportRange } from "../utils/exportRangeState";
import { applyPlatformFilters } from "../utils/platformFilterApply";
import {
  buildAllBranchGoogleMovement,
  fetchGoogleReviewSnapshots,
} from "../utils/googleReviewSnapshotHistory";
import { exportElementToPng } from "../utils/snapshotExport";
import { withSupabaseFallback } from "../utils/supabaseResilience";
import { buildPredictiveIntelligencePackage } from "../engines/predictiveIntelligenceEngine";
import { buildExecutiveCommandCenterPackage } from "../engines/executiveCommandCenterEngine";

const REVIEW_EVENT_SELECT =
  "event_type,employee_name,employee_role,branch_id,source_url,created_at,review_session_id,session_id";

function applyEventTimeBounds(query, exportRange) {
  if (!exportRange) return query;
  return query
    .gte("created_at", exportRange.sinceIso)
    .lte("created_at", exportRange.untilIso);
}

async function loadStaffAndSnapshots(exportRange) {
  const hours = exportRange?.rpcHours ?? 24;
  const staffByBranch = Object.fromEntries(
    await Promise.all(
      OPERATIONAL_BRANCHES.map(async (branchId) => {
        const summary = await withSupabaseFallback(
          fetchReviewEventsSummary(supabase, { branch: branchId, hours }),
          null,
        );
        return [branchId, staffFromReviewSummary(summary || { staff: [] })];
      }),
    ),
  );
  const { data: snapshots } = await fetchGoogleReviewSnapshots().catch(() => ({ data: [] }));
  return { staffByBranch, snapshots: snapshots || [] };
}

async function loadPredictivePackage(exportRange, loaded, branch) {
  const { staffByBranch, snapshots } = await loadStaffAndSnapshots(exportRange);
  return buildPredictiveIntelligencePackage({
    kpis: loaded?.kpis,
    branchComparison: loaded?.branchComparison || [],
    staffByBranch,
    snapshots,
    selectedRange: exportRange?.preset || "7d",
    activeBranch: branch || null,
  });
}

async function loadExecutiveCommandPackage(exportRange, loaded) {
  const { staffByBranch, snapshots } = await loadStaffAndSnapshots(exportRange);
  return buildExecutiveCommandCenterPackage({
    kpis: loaded?.kpis,
    branchComparison: loaded?.branchComparison || [],
    staffByBranch,
    snapshots,
    selectedRange: exportRange?.preset || "7d",
    dailyTrend: [],
  });
}

function reportExportFailure(err, label = "Export") {
  const msg = err?.message || "Export failed. Try a shorter date range or refresh data.";
  if (typeof window !== "undefined") {
    window.alert(`${label}: ${msg}`);
  }
}

export function useReviewExports(filters) {
  const [pngBusy, setPngBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [executiveBusy, setExecutiveBusy] = useState(false);
  const configured = isSupabaseConfigured();

  const selectedRange = filters?.selectedRange || "7d";
  const branch = filters?.branch || null;
  const dashboardRangeLabel = rangeExportLabel(selectedRange);
  const branchLabel = branch ? branchDisplayName(branch) : "All branches";

  const dashboardExportRange = useMemo(
    () => resolveExportRange({ preset: "dashboard", dashboardRange: selectedRange }),
    [selectedRange],
  );

  const loadEvents = useCallback(
    async (exportRange = null) => {
      const range = exportRange || dashboardExportRange;
      const useRpc = exportRange ? exportRange.useRpc : dashboardExportRange.useRpc;
      const hours = exportRange ? exportRange.rpcHours : dashboardExportRange.rpcHours;

      if (useRpc) {
        const summary = await withSupabaseFallback(
          fetchReviewEventsSummary(supabase, {
            branch: branch || null,
            hours,
          }),
          null,
        );

        if (summary) {
          const allSummary = await withSupabaseFallback(
            branch != null
              ? fetchReviewEventsSummary(supabase, { branch: null, hours })
              : Promise.resolve(summary),
            summary,
          );
          return {
            events: [],
            all: [],
            summary,
            fromRpc: true,
            kpis: kpisFromReviewSummary(summary),
            branchComparison: branchComparisonFromReviewSummary(allSummary),
            exportRange: range,
          };
        }
      }

      let branchQ = supabase
        .from("review_events")
        .select(REVIEW_EVENT_SELECT)
        .order("created_at", { ascending: false })
        .limit(2500);
      let allQ = supabase
        .from("review_events")
        .select(REVIEW_EVENT_SELECT)
        .order("created_at", { ascending: false })
        .limit(3000);

      branchQ = applyEventTimeBounds(branchQ, range);
      allQ = applyEventTimeBounds(allQ, range);

      if (branch) {
        branchQ = branchQ.eq("branch_id", branch);
      }

      const [{ data: branchEvents }, { data: allEvents }] = await Promise.all([branchQ, allQ]);

      const events = applyPlatformFilters(branchEvents || [], filters);
      const all = applyPlatformFilters(allEvents || [], filters);
      return { events, all, exportRange: range, fromRpc: false };
    },
    [branch, filters, dashboardExportRange],
  );

  const buildSummaryContext = useCallback(
    (loaded, exportRange) => {
      const events = loaded?.events || [];
      const all = loaded?.all || [];
      const kpis = loaded?.kpis || computeReviewKpis(events);
      const staffMerged = loaded?.summary
        ? staffFromReviewSummary(loaded.summary)
        : mergeStaffStats([], aggregateStaffReviewStats(events, branch));
      const employees = buildEmployeePerformance(
        staffMerged.map((s) => ({
          name: s.name,
          role: s.role,
          generated: s.generated,
          google_clicks: s.google,
          opens: s.scans,
        })),
      );

      const range = exportRange || loaded?.exportRange || dashboardExportRange;

      return {
        branch: branchLabel,
        selectedRange: range.preset,
        rangeLabel: range.periodLabel,
        periodLabel: range.periodLabel,
        review: {
          qr_scans: kpis?.qr_scans ?? 0,
          reviews_generated: kpis?.reviews_generated ?? 0,
          google_clicks: kpis?.google_redirects ?? 0,
          conversion_pct: kpis?.conversion_pct ?? 0,
        },
        staffStats: staffMerged,
        employees,
        diagnostics: loaded?.fromRpc
          ? []
          : runReviewDataQualityDiagnostics(events, branch),
        branchComparison: loaded?.branchComparison || buildBranchReviewComparison(all),
      };
    },
    [branch, branchLabel, dashboardExportRange],
  );

  const exportSnapshotPng = useCallback(
    async (snapshotEl) => {
      if (!snapshotEl || pngBusy) return;
      setPngBusy(true);
      try {
        const safeBranch = (branch || "network").toString().toLowerCase();
        await exportElementToPng(
          snapshotEl,
          `nac-${safeBranch}-${selectedRange}-snapshot-${Date.now()}.png`,
        );
      } catch (err) {
        reportExportFailure(err, "Snapshot PNG");
      } finally {
        setPngBusy(false);
      }
    },
    [pngBusy, branch, selectedRange],
  );

  const loadBranchAuditReports = useCallback(
    async (exportRange = null) => {
      const range = exportRange || dashboardExportRange;

      const reports = await Promise.all(
        OPERATIONAL_BRANCHES.map(async (branchId) => {
          if (range.useRpc) {
            const summary = await withSupabaseFallback(
              fetchReviewEventsSummary(supabase, {
                branch: branchId,
                hours: range.rpcHours,
              }),
              null,
            );
            if (summary) {
              return buildBranchOperationalReportFromSummary(summary, branchId);
            }
          }

          let q = supabase
            .from("review_events")
            .select(REVIEW_EVENT_SELECT)
            .eq("branch_id", branchId)
            .order("created_at", { ascending: false })
            .limit(2500);
          q = applyEventTimeBounds(q, range);
          const { data: raw } = await q;
          const events = applyPlatformFilters(raw || [], filters);
          return buildBranchOperationalReport(events, branchId);
        }),
      );

      return reports.filter(Boolean);
    },
    [filters, dashboardExportRange],
  );

  const exportBranchAuditPdf = useCallback(
    async (exportRange = null) => {
      if (!configured || auditBusy) return;
      const range = exportRange || dashboardExportRange;
      setAuditBusy(true);
      try {
        const { exportDetailedBranchOperationalReview } = await import(
          "../engines/detailedBranchReviewExport"
        );
        const reports = await loadBranchAuditReports(range);
        const { data: snapshots } = await fetchGoogleReviewSnapshots().catch(() => ({
          data: [],
        }));
        const googleMovement = buildAllBranchGoogleMovement(snapshots || [], {
          periodStartDate: range.startDate,
          periodEndDate: range.endDate,
          periodLabel: range.periodLabel,
        });
        const loaded = await loadEvents(range);
        const predictive = await loadPredictivePackage(range, loaded, branch);
        exportDetailedBranchOperationalReview({
          reports,
          rangeLabel: range.periodLabel,
          periodLabel: range.periodLabel,
          selectedRange: range.preset,
          googleMovement,
          predictivePackage: predictive,
        });
      } catch (err) {
        reportExportFailure(err, "Branch audit PDF");
      } finally {
        setAuditBusy(false);
      }
    },
    [configured, auditBusy, loadBranchAuditReports, dashboardExportRange, loadEvents, branch],
  );

  const exportSummaryPdf = useCallback(
    async (exportRange = null) => {
      if (!configured || summaryBusy) return;
      const range = exportRange || dashboardExportRange;
      setSummaryBusy(true);
      try {
        const { exportReviewIntelligenceReport } = await import("../engines/exportEngine");
        const loaded = await loadEvents(range);
        const [predictive, commandPackage] = await Promise.all([
          loadPredictivePackage(range, loaded, branch),
          loadExecutiveCommandPackage(range, loaded),
        ]);
        exportReviewIntelligenceReport({
          ...buildSummaryContext(loaded, range),
          predictivePackage: predictive,
          commandPackage,
          format: "pdf",
        });
      } catch (err) {
        reportExportFailure(err, "Summary PDF");
      } finally {
        setSummaryBusy(false);
      }
    },
    [configured, summaryBusy, loadEvents, buildSummaryContext, dashboardExportRange, branch],
  );

  const exportExecutiveSummaryPdf = useCallback(
    async (exportRange = null) => {
      if (!configured || executiveBusy) return;
      const range = exportRange || dashboardExportRange;
      setExecutiveBusy(true);
      try {
        const loaded = await loadEvents(range);
        const commandPackage = await loadExecutiveCommandPackage(range, loaded);
        const { exportExecutiveCommandCenterPdf } = await import(
          "../engines/executiveCommandCenterPdfExport"
        );
        exportExecutiveCommandCenterPdf({
          commandPackage,
          rangeLabel: range.periodLabel,
        });
      } catch (err) {
        reportExportFailure(err, "Executive Summary PDF");
      } finally {
        setExecutiveBusy(false);
      }
    },
    [configured, executiveBusy, loadEvents, dashboardExportRange],
  );

  const exportSummaryXlsx = useCallback(
    async (exportRange = null) => {
      if (!configured || summaryBusy) return;
      const range = exportRange || dashboardExportRange;
      setSummaryBusy(true);
      try {
        const { exportReviewIntelligenceReport } = await import("../engines/exportEngine");
        const loaded = await loadEvents(range);
        exportReviewIntelligenceReport({
          ...buildSummaryContext(loaded, range),
          format: "xlsx",
        });
      } catch (err) {
        reportExportFailure(err, "Summary XLSX");
      } finally {
        setSummaryBusy(false);
      }
    },
    [configured, summaryBusy, loadEvents, buildSummaryContext, dashboardExportRange],
  );

  return useMemo(
    () => ({
      configured,
      dashboardRangeLabel,
      exportSnapshotPng,
      exportBranchAuditPdf,
      exportSummaryPdf,
      exportSummaryXlsx,
      exportExecutiveSummaryPdf,
      busy: { png: pngBusy, audit: auditBusy, summary: summaryBusy, executive: executiveBusy },
    }),
    [
      configured,
      dashboardRangeLabel,
      exportSnapshotPng,
      exportBranchAuditPdf,
      exportSummaryPdf,
      exportSummaryXlsx,
      exportExecutiveSummaryPdf,
      pngBusy,
      auditBusy,
      summaryBusy,
      executiveBusy,
    ],
  );
}
