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
  Trophy,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
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
import { getBusinessDayKey } from "./utils/businessDay";
import {
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  rangeToHours,
  rangeToSince,
  branchDisplayName,
  defaultBranchId,
  rangeExportLabel,
} from "./utils/rangeState";
import {
  aggregateStaffReviewStats,
  mergeStaffStats,
  buildDailyScanTrend,
  buildBranchScanTotals,
  sumScans,
} from "./utils/staffReviewStats";
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
  const [staffMerged, setStaffMerged] = useState([]);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [branchScans, setBranchScans] = useState([]);
  const [allBranchEvents, setAllBranchEvents] = useState([]);
  const [debugEvents, setDebugEvents] = useState([]);
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

      const since = rangeToSince(selectedRange);

      let reviewQ = supabase
        .from("review_events")
        .select("event_type,employee_name,employee_role,branch_id,source_url,created_at")
        .limit(3000);
      let reviewAllQ = supabase
        .from("review_events")
        .select("event_type,employee_name,branch_id,created_at")
        .limit(5000);

      let menuQ = supabase
        .from("menu_events")
        .select("session_id,event_type,category_id,item_name_en,created_at")
        .eq("branch_id", branch)
        .limit(500);

      if (since) {
        reviewQ = reviewQ.gte("created_at", since);
        reviewAllQ = reviewAllQ.gte("created_at", since);
        menuQ = menuQ.gte("created_at", since);
      }

      reviewQ = reviewQ.eq("branch_id", branch);

      let debugQ = supabase
        .from("review_events")
        .select("created_at,branch_id,employee_name,employee_role,event_type")
        .eq("branch_id", branch)
        .order("created_at", { ascending: false })
        .limit(20);

      if (since) {
        debugQ = debugQ.gte("created_at", since);
      }

      const [{ data: reviewEvents }, { data: reviewAll }, { data: menuEvents }, { data: debugRows }] =
        await Promise.all([reviewQ, reviewAllQ, menuQ, debugQ]);

      const branchEvents = reviewEvents || [];
      const allEvents = reviewAll || [];
      setAllBranchEvents(allEvents);
      setDebugEvents(debugRows || []);

      const granular = aggregateStaffReviewStats(branchEvents, branch);
      const merged = mergeStaffStats(rev?.top_employees || [], granular);
      setStaffMerged(merged);
      setDailyTrend(buildDailyScanTrend(branchEvents));
      setBranchScans(buildBranchScanTotals(allEvents));

      setDiag(
        runDataQualityDiagnostics({
          menuEvents: menuEvents || [],
          reviewEvents: branchEvents,
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

  const branchTotalScans = useMemo(
    () => branchScans.find((b) => b.branch_id === branch)?.scans ?? sumScans(allBranchEvents.filter((e) => e.branch_id === branch)),
    [branchScans, branch, allBranchEvents]
  );

  const leaderboardData = useMemo(
    () =>
      staffMerged.slice(0, 10).map((s) => ({
        name: s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name,
        scans: s.scans,
        google: s.google,
        conversion: s.conversion_pct,
      })),
    [staffMerged]
  );

  const reviewsByStaffData = useMemo(
    () =>
      staffMerged.slice(0, 8).map((s) => ({
        name: s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name,
        reviews: s.review_opens,
      })),
    [staffMerged]
  );

  const topStaff = staffMerged[0];

  const exportContext = useMemo(
    () => ({
      branch: branchLabel,
      selectedRange,
      rangeLabel,
      review: reviewData,
      unified,
      comparison,
      staffStats: staffMerged,
      employees,
      diagnostics: diag,
      branchTotalScans,
      dailyTrend,
      branchScans,
    }),
    [
      branchLabel,
      selectedRange,
      rangeLabel,
      reviewData,
      unified,
      comparison,
      staffMerged,
      employees,
      diag,
      branchTotalScans,
      dailyTrend,
      branchScans,
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
        <motion.div className="rev-intel-header-top">
          <p className="rev-intel-kicker">NAC REVIEW OS</p>
          <h1>Review Intelligence</h1>
          <p className="rev-intel-sub">
            {branchLabel} · {rangeLabel}
            {selectedRange === "today" ? " · 3:00 AM – 2:59 AM (Asia/Riyadh)" : ""}
          </p>
        </motion.div>

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

          <button type="button" className="rev-ctrl-btn rev-ctrl-action" onClick={load} disabled={loading} aria-label="Refresh">
            <RefreshCw size={14} className={loading ? "nac-bi-spin" : ""} />
          </button>
          <button type="button" className="rev-ctrl-btn rev-ctrl-action" onClick={handleSnapshot} disabled={snapshotBusy}>
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
        <motion.div className="rev-intel-alert">
          <AlertCircle size={16} /> {error}
        </motion.div>
      )}

      {loading ? (
        <p className="rev-intel-muted">Loading intelligence…</p>
      ) : (
        <>
          <motion.div className="rev-kpi-grid" layout>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Branch scans ({rangeLabel})</span>
              <strong>{branchTotalScans}</strong>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Reviews generated</span>
              <strong>{reviewData?.reviews_generated ?? 0}</strong>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Google redirects</span>
              <strong>{reviewData?.google_clicks ?? 0}</strong>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Review conversion</span>
              <strong>{reviewData?.conversion_pct ?? 0}%</strong>
            </motion.div>
            {topStaff && (
              <motion.div className="rev-kpi-card rev-kpi-card--highlight" whileHover={{ y: -2 }}>
                <span>
                  <Trophy size={14} /> Top staff
                </span>
                <strong>{topStaff.name}</strong>
                <small>{topStaff.scans} scans · {topStaff.conversion_pct}% conv.</small>
              </motion.div>
            )}
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Menu sessions</span>
              <strong>{unified?.sessions ?? "—"}</strong>
            </motion.div>
          </motion.div>

          {branchScans.length > 0 && (
            <section className="rev-section">
              <h2>
                <GitBranch size={18} /> Total scans by branch
              </h2>
              <motion.div className="rev-branch-table">
                <div className="rev-branch-row head">
                  <span>Branch</span>
                  <span>Scans</span>
                </div>
                {branchScans.map((row) => (
                  <div
                    key={row.branch_id}
                    className={`rev-branch-row ${row.branch_id === branch ? "rev-branch-highlight" : ""}`}
                  >
                    <span>{branchDisplayName(row.branch_id)}</span>
                    <span>{row.scans}</span>
                  </div>
                ))}
              </motion.div>
            </section>
          )}

          {staffMerged.length > 0 && (
            <section className="rev-section">
              <h2>
                <Users size={18} /> Staff performance table
              </h2>
              <div className="rev-staff-table-wrap">
                <table className="rev-staff-table">
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Role</th>
                      <th>Branch</th>
                      <th>Scans</th>
                      <th>Review opens</th>
                      <th>Generated</th>
                      <th>Copies</th>
                      <th>Google redirects</th>
                      <th>Conversion %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffMerged.map((s) => (
                      <tr key={s.name}>
                        <td>
                          <strong>{s.name}</strong>
                        </td>
                        <td>{s.role || "—"}</td>
                        <td>{s.branch ? branchDisplayName(s.branch) : branchLabel}</td>
                        <td>{s.scans}</td>
                        <td>{s.review_opens}</td>
                        <td>{s.generated}</td>
                        <td>{s.copy}</td>
                        <td>{s.google}</td>
                        <td>{s.conversion_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="rev-section rev-debug-panel">
            <h2>Debug — latest review events</h2>
            <p className="rev-intel-muted">Last 20 rows for {branchLabel} (verify employee_name from QR `s=` param)</p>
            <div className="rev-staff-table-wrap">
              <table className="rev-staff-table rev-debug-table">
                <thead>
                  <tr>
                    <th>created_at</th>
                    <th>branch</th>
                    <th>employee_name</th>
                    <th>employee_role</th>
                    <th>event_type</th>
                  </tr>
                </thead>
                <tbody>
                  {debugEvents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="rev-intel-muted">
                        No review events for this branch yet.
                      </td>
                    </tr>
                  ) : (
                    debugEvents.map((row) => (
                      <tr key={`${row.created_at}-${row.event_type}-${row.employee_name}`}>
                        <td>{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td>
                        <td>{row.branch_id || "—"}</td>
                        <td>{row.employee_name || <em className="rev-missing">empty</em>}</td>
                        <td>{row.employee_role || "—"}</td>
                        <td>{row.event_type}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="rev-charts-grid">
            {leaderboardData.length > 0 && (
              <section className="rev-section rev-chart-panel">
                <h2>
                  <Users size={18} /> Staff leaderboard
                </h2>
                <div className="rev-chart-box">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={leaderboardData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="name" tick={{ fill: "rgba(249,249,247,0.65)", fontSize: 10 }} />
                      <YAxis tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                      <Tooltip contentStyle={CHART_TOOLTIP} />
                      <Bar dataKey="scans" name="Scans" fill="#4ecdc4" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="google" name="Google" fill="#d7bc8a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {dailyTrend.length > 0 && (
              <section className="rev-section rev-chart-panel">
                <h2>
                  <TrendingUp size={18} /> Daily scans trend
                </h2>
                <motion.div className="rev-chart-box">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={dailyTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tick={{ fill: "rgba(249,249,247,0.55)", fontSize: 9 }} />
                      <YAxis tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                      <Tooltip contentStyle={CHART_TOOLTIP} />
                      <Line type="monotone" dataKey="scans" stroke="#4ecdc4" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </motion.div>
              </section>
            )}

            {reviewsByStaffData.length > 0 && (
              <section className="rev-section rev-chart-panel">
                <h2>
                  <Star size={18} /> Reviews opened by staff
                </h2>
                <div className="rev-chart-box">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={reviewsByStaffData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis type="number" tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={72} tick={{ fill: "rgba(249,249,247,0.65)", fontSize: 10 }} />
                      <Tooltip contentStyle={CHART_TOOLTIP} />
                      <Bar dataKey="reviews" name="Generated" fill="#d7bc8a" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}
          </div>

          <section className="rev-section">
            <h2>
              <Users size={18} /> Employee cards
            </h2>
            <div className="rev-emp-grid">
              {employees.length === 0 && staffMerged.length === 0 ? (
                <p className="rev-intel-muted">No employee-tagged review events yet.</p>
              ) : (
                (staffMerged.length ? staffMerged : employees.map((e) => ({ name: e.name, role: e.role, scans: 0, review_opens: 0, copy: 0, google: 0, conversion_pct: 0 }))).map((emp) => {
                  const perf = employees.find((e) => e.name === emp.name);
                  return (
                    <motion.div key={emp.name} className="rev-emp-card" whileHover={{ scale: 1.01 }}>
                      <div className="rev-emp-top">
                        <strong>{emp.name}</strong>
                        {perf && <span className="rev-badge">{perf.classification.label}</span>}
                      </div>
                      <p className="rev-emp-role">{emp.role || perf?.role || "Staff"}</p>
                      {perf && <p className="rev-emp-reason">{perf.classification.reason}</p>}
                      <div className="rev-emp-metrics">
                        <span>{emp.scans} scans</span>
                        <span>{emp.review_opens} generated</span>
                        <span>{emp.copy} copies</span>
                        <span>{emp.google} Google</span>
                        <span>{emp.conversion_pct}% conv.</span>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </section>

          <section className="rev-section">
            <h2>
              <GitBranch size={18} /> Branch comparison
            </h2>
            <div className="rev-branch-table">
              <motion.div className="rev-branch-row head">
                <span>Branch</span>
                <span>Sessions</span>
                <span>Visual conv.</span>
                <span>Reviews</span>
                <span>Sales</span>
              </motion.div>
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
