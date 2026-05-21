import { useState, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { fetchReviewEventsSummary } from "../../lib/intelligenceQueryApi";
import {
  kpisFromReviewSummary,
  staffFromReviewSummary,
  branchComparisonFromReviewSummary,
} from "../utils/reviewSummaryMap";
import { exportReviewIntelligenceReport } from "../engines/exportEngine";
import {
  OPERATIONAL_BRANCHES,
  buildBranchOperationalReport,
  buildBranchOperationalReportFromSummary,
} from "../engines/branchOperationalReviewEngine";
import { exportDetailedBranchOperationalReview } from "../engines/detailedBranchReviewExport";
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

const REVIEW_EVENT_SELECT =
  "event_type,employee_name,employee_role,branch_id,source_url,created_at,review_session_id,session_id";

function applyEventTimeBounds(query, exportRange) {
  if (!exportRange) return query;
  return query
    .gte("created_at", exportRange.sinceIso)
    .lte("created_at", exportRange.untilIso);
}

export function useReviewExports(filters) {
  const [pngBusy, setPngBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
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
        const summary = await fetchReviewEventsSummary(supabase, {
          branch: branch || null,
          hours,
        }).catch(() => null);

        if (summary) {
          const allSummary =
            branch != null
              ? await fetchReviewEventsSummary(supabase, { branch: null, hours }).catch(
                  () => summary,
                )
              : summary;
          const events = staffFromReviewSummary(summary).map((s) => ({
            event_type: "qr_scan",
            employee_name: s.name,
            employee_role: s.role,
            branch_id: branch || "",
          }));
          return {
            events,
            all: branchComparisonFromReviewSummary(allSummary).flatMap((b) =>
              Array.from({ length: b.qr_scans }, () => ({
                event_type: "qr_scan",
                branch_id: b.branch_id,
              })),
            ),
            summary,
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
      return { events, all, exportRange: range };
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
        diagnostics: runReviewDataQualityDiagnostics(events, branch),
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
            try {
              const summary = await fetchReviewEventsSummary(supabase, {
                branch: branchId,
                hours: range.rpcHours,
              });
              if (summary) {
                return buildBranchOperationalReportFromSummary(summary, branchId);
              }
            } catch (_) {
              /* fall through to raw events */
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

      return reports;
    },
    [filters, dashboardExportRange],
  );

  const exportBranchAuditPdf = useCallback(
    async (exportRange = null) => {
      if (!configured || auditBusy) return;
      const range = exportRange || dashboardExportRange;
      setAuditBusy(true);
      try {
        const reports = await loadBranchAuditReports(range);
        const { data: snapshots } = await fetchGoogleReviewSnapshots();
        const googleMovement = buildAllBranchGoogleMovement(snapshots || [], {
          periodStartDate: range.startDate,
          periodEndDate: range.endDate,
          periodLabel: range.periodLabel,
        });
        exportDetailedBranchOperationalReview({
          reports,
          rangeLabel: range.periodLabel,
          periodLabel: range.periodLabel,
          selectedRange: range.preset,
          googleMovement,
        });
      } finally {
        setAuditBusy(false);
      }
    },
    [configured, auditBusy, loadBranchAuditReports, dashboardExportRange],
  );

  const exportSummaryPdf = useCallback(
    async (exportRange = null) => {
      if (!configured || summaryBusy) return;
      const range = exportRange || dashboardExportRange;
      setSummaryBusy(true);
      try {
        const loaded = await loadEvents(range);
        exportReviewIntelligenceReport({
          ...buildSummaryContext(loaded, range),
          format: "pdf",
        });
      } finally {
        setSummaryBusy(false);
      }
    },
    [configured, summaryBusy, loadEvents, buildSummaryContext, dashboardExportRange],
  );

  const exportSummaryXlsx = useCallback(
    async (exportRange = null) => {
      if (!configured || summaryBusy) return;
      const range = exportRange || dashboardExportRange;
      setSummaryBusy(true);
      try {
        const loaded = await loadEvents(range);
        exportReviewIntelligenceReport({
          ...buildSummaryContext(loaded, range),
          format: "xlsx",
        });
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
      busy: { png: pngBusy, audit: auditBusy, summary: summaryBusy },
    }),
    [
      configured,
      dashboardRangeLabel,
      exportSnapshotPng,
      exportBranchAuditPdf,
      exportSummaryPdf,
      exportSummaryXlsx,
      pngBusy,
      auditBusy,
      summaryBusy,
    ],
  );
}
