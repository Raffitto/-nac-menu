import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Star,
  RefreshCw,
  Camera,
  Users,
  GitBranch,
  FileDown,
  FileText,
  AlertCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  fetchReviewIntelligence,
  fetchUnifiedSummary,
  fetchBranchComparison,
  generateDailySnapshot,
} from "./utils/unifiedIntelligenceApi";
import { buildEmployeePerformance } from "./engines/employeePerformanceEngine";
import { runDataQualityDiagnostics } from "./utils/dataQualityDiagnostics";
import { exportReviewIntelligenceReport } from "./engines/exportEngine";
import { getBusinessDayKey, getBusinessDayRange } from "./utils/businessDay";
import {
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  rangeToHours,
  branchDisplayName,
  defaultBranchId,
  rangeExportLabel,
} from "./utils/rangeState";
import { aggregateStaffReviewStats } from "./utils/staffReviewStats";
import "./styles/review-intelligence.css";

const BRANCHES = ["khobar", "riyadh", "jeddah"];
const CHART_TOOLTIP = {
  background: "rgba(8,10,12,0.94)",
  border: "1px solid rgba(215,188,138,0.35)",
  borderRadius: 12,
  color: "#f9f9f7",
  fontSize: 12,
};

export default function ReviewIntelligence() {
  const [branch, setBranch] = useState(defaultBranchId());
  const [selectedRange, setSelectedRange] = useState(DEFAULT_RANGE);
  const hours = rangeToHours(selectedRange);

  const [reviewData, setReviewData] = useState(null);
  const [unified, setUnified] = useState(null);
  const [comparison, setComparison] = useState([]);
  const [staffStats, setStaffStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [error, setError] = useState("");
  const [diag, setDiag] = useState(null);

  const configured = isSupabaseConfigured();
  const branchLabel = branchDisplayName(branch);
  const rangeLabel = rangeExportLabel(selectedRange);

  const load = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const unifiedPromise =
        selectedRange === "today"
          ? fetchUnifiedSummary(branch, getBusinessDayKey())
          : Promise.resolve(null);

      const [rev, uni, cmp] = await Promise.all([
        fetchReviewIntelligence(branch, hours),
        unifiedPromise,
        fetchBranchComparison(hours),
      ]);
      setReviewData(rev);
      setUnified(uni);
      setComparison(Array.isArray(cmp) ? cmp : []);

      const since =
        selectedRange === "today"
          ? getBusinessDayRange().start.toISOString()
          : null;

      let menuQ = supabase
        .from("menu_events")
        .select("session_id,event_type,category_id,item_name_en,created_at")
        .eq("branch_id", branch)
        .limit(500);
      let reviewQ = supabase
        .from("review_events")
        .select("event_type,employee_name,employee_role,source_url,created_at")
        .eq("branch_id", branch)
        .limit(500);

      if (since) {
        menuQ = menuQ.gte("created_at", since);
        reviewQ = reviewQ.gte("created_at", since);
      } else if (hours > 0) {
        const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
        menuQ = menuQ.gte("created_at", cutoff);
        reviewQ = reviewQ.gte("created_at", cutoff);
      }

      const [{ data: menuEvents }, { data: reviewEvents }] = await Promise.all([
        menuQ,
        reviewQ,
      ]);
      setStaffStats(aggregateStaffReviewStats(reviewEvents || [], branch));
      setDiag(
        runDataQualityDiagnostics({
          menuEvents: menuEvents || [],
          reviewEvents: reviewEvents || [],
          branchId: branch,
        })
      );
    } catch (e) {
      setError(e.message || "Failed to load review intelligence");
    } finally {
      setLoading(false);
    }
  }, [branch, hours, selectedRange, configured]);

  useEffect(() => {
    load();
  }, [load]);

  const employees = useMemo(
    () => buildEmployeePerformance(reviewData?.top_employees || []),
    [reviewData]
  );

  const staffChartData = useMemo(
    () =>
      staffStats.slice(0, 8).map((s) => ({
        name: s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name,
        opens: s.opens,
        google: s.google,
        conversion: s.conversion_pct,
      })),
    [staffStats]
  );

  const exportContext = useMemo(
    () => ({
      branch: branchLabel,
      selectedRange,
      rangeLabel,
      review: reviewData,
      unified,
      comparison,
      staffStats,
      employees,
      diagnostics: diag,
    }),
    [
      branchLabel,
      selectedRange,
      rangeLabel,
      reviewData,
      unified,
      comparison,
      staffStats,
      employees,
      diag,
    ]
  );

  const handleSnapshot = async () => {
    setSnapshotBusy(true);
    try {
      await generateDailySnapshot(branch);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSnapshotBusy(false);
    }
  };

  const handleExportXlsx = () => {
    exportReviewIntelligenceReport({ ...exportContext, format: "xlsx" });
  };

  const handleExportPdf = () => {
    exportReviewIntelligenceReport({ ...exportContext, format: "pdf" });
  };

  if (!configured) {
    return (
      <motion.div className="rev-intel-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <p className="rev-intel-muted">Connect Supabase to enable Review Intelligence.</p>
      </motion.div>
    );
  }

  return (
    <motion.div className="rev-intel-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="rev-intel-header">
        <div className="rev-intel-header-top">
          <p className="rev-intel-kicker">NAC REVIEW OS</p>
          <h1>Review Intelligence</h1>
          <p className="rev-intel-sub">
            {branchLabel} · {rangeLabel}
            {selectedRange === "today" ? " · 3:00 AM – 2:59 AM (Asia/Riyadh)" : ""}
          </p>
        </div>

        <motion.div
          className="rev-intel-controls"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          role="toolbar"
          aria-label="Review intelligence filters"
        >
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="rev-ctrl-select"
            aria-label="Branch"
          >
            {BRANCHES.map((b) => (
              <option key={b} value={b}>
                {branchDisplayName(b)}
              </option>
            ))}
          </select>

          <motion.div className="rev-ctrl-group">
            {RANGE_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.title}
                className={`rev-ctrl-btn rev-ctrl-gold ${selectedRange === t.id ? "active" : ""}`}
                onClick={() => setSelectedRange(t.id)}
              >
                {t.label}
              </button>
            ))}
          </motion.div>

          <button
            type="button"
            className="rev-ctrl-btn rev-ctrl-action"
            onClick={load}
            disabled={loading}
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? "nac-bi-spin" : ""} />
          </button>
          <button
            type="button"
            className="rev-ctrl-btn rev-ctrl-action"
            onClick={handleSnapshot}
            disabled={snapshotBusy}
          >
            <Camera size={14} /> Snapshot
          </button>
          <button type="button" className="rev-ctrl-btn rev-ctrl-action" onClick={handleExportXlsx}>
            <FileDown size={14} /> XLSX
          </button>
          <button type="button" className="rev-ctrl-btn rev-ctrl-action" onClick={handleExportPdf}>
            <FileText size={14} /> PDF
          </button>
        </motion.div>
      </header>

      {error && (
        <div className="rev-intel-alert">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <p className="rev-intel-muted">Loading intelligence…</p>
      ) : (
        <>
          <div className="rev-kpi-grid">
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Reviews generated</span>
              <strong>{reviewData?.reviews_generated ?? 0}</strong>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Google clicks</span>
              <strong>{reviewData?.google_clicks ?? 0}</strong>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Review conversion</span>
              <strong>{reviewData?.conversion_pct ?? 0}%</strong>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Menu sessions</span>
              <strong>{unified?.sessions ?? "—"}</strong>
            </motion.div>
          </div>

          {staffChartData.length > 0 && (
            <section className="rev-section">
              <h2>
                <Users size={18} /> Staff funnel
              </h2>
              <div className="rev-chart-box">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={staffChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" tick={{ fill: "rgba(249,249,247,0.65)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Bar dataKey="opens" name="Scans" fill="#4ecdc4" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="google" name="Google" fill="#d7bc8a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className="rev-section">
            <h2>
              <Users size={18} /> Employee performance
            </h2>
            <div className="rev-emp-grid">
              {employees.length === 0 ? (
                <p className="rev-intel-muted">No employee-tagged review events yet.</p>
              ) : (
                employees.map((emp) => {
                  const granular = staffStats.find((s) => s.name === emp.name);
                  return (
                    <motion.div key={emp.name} className="rev-emp-card" whileHover={{ scale: 1.01 }}>
                      <div className="rev-emp-top">
                        <strong>{emp.name}</strong>
                        <span className="rev-badge">{emp.classification.label}</span>
                      </div>
                      <p className="rev-emp-role">{emp.role || granular?.role || "Staff"}</p>
                      <p className="rev-emp-reason">{emp.classification.reason}</p>
                      <motion.div className="rev-emp-metrics">
                        <span>{granular?.opens ?? emp.metrics.scans_generated} scans</span>
                        <span>{granular?.generated ?? emp.metrics.reviews_generated} reviews</span>
                        <span>{granular?.copy ?? 0} copies</span>
                        <span>
                          {granular?.conversion_pct ?? emp.metrics.review_conversion_pct}% Google
                        </span>
                        <span className="rev-conf">{emp.metrics.confidence}</span>
                      </motion.div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </section>

          <section className="rev-section">
            <h2>
              <GitBranch size={18} /> Cross-branch comparison
            </h2>
            <div className="rev-branch-table">
              <div className="rev-branch-row head">
                <span>Branch</span>
                <span>Sessions</span>
                <span>Visual conv.</span>
                <span>Reviews</span>
                <span>Sales</span>
              </div>
              {comparison.map((row) => (
                <div
                  key={row.branch_id}
                  className={`rev-branch-row ${row.branch_id === branch ? "rev-branch-highlight" : ""}`}
                >
                  <span>{row.branch_id}</span>
                  <span>{row.sessions}</span>
                  <span>{row.visual_conversion_pct}%</span>
                  <span>{row.reviews}</span>
                  <span>{row.sales ? Number(row.sales).toLocaleString() : "—"}</span>
                </div>
              ))}
            </div>
          </section>

          {diag && (
            <section className="rev-section">
              <h2>
                <Star size={18} /> Data quality
              </h2>
              <p className={`rev-dq-status ${diag.healthy ? "ok" : "warn"}`}>
                {diag.healthy ? "Healthy" : `${diag.issue_count} issue(s) detected`}
              </p>
              <ul className="rev-dq-list">
                {diag.issues.length === 0 ? (
                  <li>No issues detected for this period.</li>
                ) : (
                  diag.issues.map((i) => <li key={i.code}>{i.message}</li>)
                )}
              </ul>
            </section>
          )}
        </>
      )}
    </motion.div>
  );
}
