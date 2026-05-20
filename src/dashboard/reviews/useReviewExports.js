import { useState, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { exportReviewIntelligenceReport } from "../engines/exportEngine";
import { buildAllBranchOperationalReports } from "../engines/branchOperationalReviewEngine";
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
import {
  rangeToSince,
  branchDisplayName,
  rangeExportLabel,
} from "../utils/rangeState";
import { applyPlatformFilters } from "../utils/platformFilterApply";
import { exportElementToPng } from "../utils/snapshotExport";

const REVIEW_EVENT_SELECT =
  "event_type,employee_name,employee_role,branch_id,source_url,created_at,review_session_id,session_id";

export function useReviewExports(filters) {
  const [pngBusy, setPngBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const configured = isSupabaseConfigured();

  const selectedRange = filters?.selectedRange || "7d";
  const branch = filters?.branch || null;
  const rangeLabel = rangeExportLabel(selectedRange);
  const branchLabel = branch ? branchDisplayName(branch) : "All branches";

  const loadEvents = useCallback(async () => {
    const since = rangeToSince(selectedRange);
    let branchQ = supabase
      .from("review_events")
      .select(REVIEW_EVENT_SELECT)
      .order("created_at", { ascending: false })
      .limit(5000);
    let allQ = supabase
      .from("review_events")
      .select(REVIEW_EVENT_SELECT)
      .order("created_at", { ascending: false })
      .limit(8000);

    if (since) {
      branchQ = branchQ.gte("created_at", since);
      allQ = allQ.gte("created_at", since);
    }
    if (branch) {
      branchQ = branchQ.eq("branch_id", branch);
    }

    const [{ data: branchEvents }, { data: allEvents }] = await Promise.all([
      branchQ,
      allQ,
    ]);

    const events = applyPlatformFilters(branchEvents || [], filters);
    const all = applyPlatformFilters(allEvents || [], filters);
    return { events, all };
  }, [selectedRange, branch, filters]);

  const buildSummaryContext = useCallback(
    (events, all) => {
      const kpis = computeReviewKpis(events);
      const staffMerged = mergeStaffStats(
        [],
        aggregateStaffReviewStats(events, branch),
      );
      const employees = buildEmployeePerformance(
        staffMerged.map((s) => ({
          name: s.name,
          role: s.role,
          generated: s.generated,
          google_clicks: s.google,
          opens: s.scans,
        })),
      );

      return {
        branch: branchLabel,
        selectedRange,
        rangeLabel,
        review: {
          qr_scans: kpis?.qr_scans ?? 0,
          reviews_generated: kpis?.reviews_generated ?? 0,
          google_clicks: kpis?.google_redirects ?? 0,
          conversion_pct: kpis?.conversion_pct ?? 0,
        },
        staffStats: staffMerged,
        employees,
        diagnostics: runReviewDataQualityDiagnostics(events, branch),
        branchComparison: buildBranchReviewComparison(all),
      };
    },
    [branch, branchLabel, selectedRange, rangeLabel],
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

  const exportBranchAuditPdf = useCallback(async () => {
    if (!configured || auditBusy) return;
    setAuditBusy(true);
    try {
      const { all } = await loadEvents();
      const reports = buildAllBranchOperationalReports(all);
      exportDetailedBranchOperationalReview({
        reports,
        rangeLabel,
        selectedRange,
      });
    } finally {
      setAuditBusy(false);
    }
  }, [configured, auditBusy, loadEvents, rangeLabel, selectedRange]);

  const exportSummaryPdf = useCallback(async () => {
    if (!configured || summaryBusy) return;
    setSummaryBusy(true);
    try {
      const { events, all } = await loadEvents();
      exportReviewIntelligenceReport({
        ...buildSummaryContext(events, all),
        format: "pdf",
      });
    } finally {
      setSummaryBusy(false);
    }
  }, [configured, summaryBusy, loadEvents, buildSummaryContext]);

  const exportSummaryXlsx = useCallback(async () => {
    if (!configured || summaryBusy) return;
    setSummaryBusy(true);
    try {
      const { events, all } = await loadEvents();
      exportReviewIntelligenceReport({
        ...buildSummaryContext(events, all),
        format: "xlsx",
      });
    } finally {
      setSummaryBusy(false);
    }
  }, [configured, summaryBusy, loadEvents, buildSummaryContext]);

  return useMemo(
    () => ({
      configured,
      exportSnapshotPng,
      exportBranchAuditPdf,
      exportSummaryPdf,
      exportSummaryXlsx,
      busy: { png: pngBusy, audit: auditBusy, summary: summaryBusy },
    }),
    [
      configured,
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
