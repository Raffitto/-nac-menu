import { useState, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { useRbacOptional } from "../context/RbacContext";
import { resolveReviewScope } from "../../lib/unifiedReviewTruth";
import { buildReviewBranchComparisonForProfile } from "../../lib/rbacIntelligenceScope";
import { fetchAllReviewEvents } from "./reviewEventPages";
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
import { buildPredictiveIntelligencePackage } from "../engines/predictiveIntelligenceEngine";
import { buildExecutiveCommandCenterPackage } from "../engines/executiveCommandCenterEngine";

const REVIEW_EVENT_SELECT =
  "id,event_type,employee_name,employee_role,branch_id,source_url,created_at,review_session_id,session_id,metadata";

async function loadStaffAndSnapshots(exportRange, loaded, branchIds) {
  const staffByBranch = exportRange?.useRpc
    ? Object.fromEntries(
        await Promise.all(
          branchIds.map(async (branchId) => {
            const summary = await fetchReviewEventsSummary(supabase, {
              branch: branchId,
              hours: exportRange.rpcHours,
            });
            if (!summary || summary._partial) throw new Error("Complete branch review summary is unavailable; export cancelled.");
            return [branchId, staffFromReviewSummary(summary)];
          }),
        ),
      )
    : Object.fromEntries(
        branchIds.map((branchId) => [
          branchId,
          aggregateStaffReviewStats((loaded?.events || []).filter((row) => row.branch_id === branchId)),
        ]),
      );
  const { data: snapshots } = await fetchGoogleReviewSnapshots().catch(() => ({ data: [] }));
  return { staffByBranch, snapshots: snapshots || [] };
}

async function loadPredictivePackage(exportRange, loaded, branch, branchIds) {
  const { staffByBranch, snapshots } = await loadStaffAndSnapshots(exportRange, loaded, branchIds);
  return buildPredictiveIntelligencePackage({
    kpis: loaded?.kpis,
    branchComparison: loaded?.branchComparison || [],
    staffByBranch,
    snapshots,
    selectedRange: exportRange?.preset || "7d",
    activeBranch: branch || null,
  });
}

async function loadExecutiveCommandPackage(exportRange, loaded, branchIds) {
  const { staffByBranch, snapshots } = await loadStaffAndSnapshots(exportRange, loaded, branchIds);
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
  const rbac = useRbacOptional();
  const profile = rbac?.profile;
  const [pngBusy, setPngBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [executiveBusy, setExecutiveBusy] = useState(false);
  const configured = isSupabaseConfigured();

  const selectedRange = filters?.selectedRange || "7d";
  const branch = filters?.branch || null;
  const scope = resolveReviewScope(profile, branch);
  const exportBranchIds = useMemo(
    () => scope.networkWide ? OPERATIONAL_BRANCHES : [scope.queryBranch].filter(Boolean),
    [scope.networkWide, scope.queryBranch],
  );
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

      if (!scope.networkWide && !scope.queryBranch) {
        throw new Error("Review export is not authorized for this branch.");
      }

      if (useRpc) {
        const summary = await fetchReviewEventsSummary(supabase, {
          branch: scope.queryBranch,
          hours,
        });

        if (summary && !summary._partial) {
          return {
            events: [],
            all: [],
            summary,
            fromRpc: true,
            kpis: kpisFromReviewSummary(summary),
            branchComparison: buildReviewBranchComparisonForProfile(
              profile,
              branchComparisonFromReviewSummary(summary),
            ),
            exportRange: range,
          };
        }
        throw new Error("Complete review summary is unavailable; export cancelled.");
      }

      const raw = await fetchAllReviewEvents(supabase, {
        select: REVIEW_EVENT_SELECT,
        range,
        branch: scope.queryBranch,
      });
      const events = applyPlatformFilters(raw, filters);
      return {
        events,
        all: events,
        kpis: computeReviewKpis(events),
        branchComparison: buildReviewBranchComparisonForProfile(
          profile,
          buildBranchReviewComparison(events),
        ),
        exportRange: range,
        fromRpc: false,
      };
    },
    [filters, dashboardExportRange, profile, scope.queryBranch, scope.networkWide],
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
          ...s,
          name: s.name,
          role: s.role,
          branch: s.branch,
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
          ...kpis,
          qr_scans: kpis?.qr_scans ?? 0,
          reviews_generated: kpis?.reviews_generated ?? 0,
          google_clicks: kpis?.google_redirects ?? 0,
          conversion_pct: kpis?.conversion_pct ?? null,
        },
        staffStats: staffMerged,
        employees,
        diagnostics: loaded?.fromRpc
          ? []
          : runReviewDataQualityDiagnostics(events, branch),
        branchComparison: loaded?.branchComparison || buildReviewBranchComparisonForProfile(profile, buildBranchReviewComparison(all)),
      };
    },
    [branch, branchLabel, dashboardExportRange, profile],
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
      if (!scope.networkWide && !scope.queryBranch) {
        throw new Error("Review export is not authorized for this branch.");
      }

      const reports = await Promise.all(
        (scope.networkWide ? OPERATIONAL_BRANCHES : [scope.queryBranch]).map(async (branchId) => {
          if (range.useRpc) {
            const summary = await fetchReviewEventsSummary(supabase, {
              branch: branchId,
              hours: range.rpcHours,
            });
            if (!summary || summary._partial) throw new Error("Complete branch review summary is unavailable; export cancelled.");
            return buildBranchOperationalReportFromSummary(summary, branchId);
          }

          const raw = await fetchAllReviewEvents(supabase, {
            select: REVIEW_EVENT_SELECT,
            range,
            branch: branchId,
          });
          const events = applyPlatformFilters(raw, filters);
          return buildBranchOperationalReport(events, branchId);
        }),
      );

      return reports.filter(Boolean);
    },
    [filters, dashboardExportRange, scope.networkWide, scope.queryBranch],
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
        const predictive = await loadPredictivePackage(range, loaded, branch, exportBranchIds);
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
    [configured, auditBusy, loadBranchAuditReports, dashboardExportRange, loadEvents, branch, exportBranchIds],
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
          loadPredictivePackage(range, loaded, branch, exportBranchIds),
          loadExecutiveCommandPackage(range, loaded, exportBranchIds),
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
    [configured, summaryBusy, loadEvents, buildSummaryContext, dashboardExportRange, branch, exportBranchIds],
  );

  const exportExecutiveSummaryPdf = useCallback(
    async (exportRange = null) => {
      if (!configured || executiveBusy) return;
      const range = exportRange || dashboardExportRange;
      setExecutiveBusy(true);
      try {
        const loaded = await loadEvents(range);
        const commandPackage = await loadExecutiveCommandPackage(range, loaded, exportBranchIds);
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
    [configured, executiveBusy, loadEvents, dashboardExportRange, exportBranchIds],
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

  const exportSummaryCsv = useCallback(
    async (exportRange = null) => {
      if (!configured || summaryBusy) return;
      const range = exportRange || dashboardExportRange;
      setSummaryBusy(true);
      try {
        const { exportReviewIntelligenceReport } = await import("../engines/exportEngine");
        const loaded = await loadEvents(range);
        exportReviewIntelligenceReport({
          ...buildSummaryContext(loaded, range),
          format: "csv",
        });
      } catch (err) {
        reportExportFailure(err, "Summary CSV");
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
      exportSummaryCsv,
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
      exportSummaryCsv,
      exportExecutiveSummaryPdf,
      pngBusy,
      auditBusy,
      summaryBusy,
      executiveBusy,
    ],
  );
}
