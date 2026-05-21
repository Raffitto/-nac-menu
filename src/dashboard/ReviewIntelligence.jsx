import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Star,
  RefreshCw,
  Camera,
  Users,
  GitBranch,
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
import { fetchReviewEventsSummary } from "../lib/intelligenceQueryApi";
import { generateDailySnapshot } from "./utils/unifiedIntelligenceApi";
import { buildEmployeePerformance } from "./engines/employeePerformanceEngine";
import {
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  rangeToSince,
  rangeToHours,
  branchDisplayName,
  defaultBranchId,
  rangeExportLabel,
} from "./utils/rangeState";
import { usePlatformFiltersOptional } from "./context/PlatformFiltersContext";
import { applyPlatformFilters } from "./utils/platformFilterApply";
import {
  aggregateStaffReviewStats,
  mergeStaffStats,
  buildDailyScanTrend,
  buildBranchScanTotals,
} from "./utils/staffReviewStats";
import {
  computeReviewKpis,
  buildBranchReviewComparison,
} from "./utils/reviewEventMetrics";
import {
  kpisFromReviewSummary,
  staffFromReviewSummary,
  dailyTrendFromReviewSummary,
  branchComparisonFromReviewSummary,
  branchScansFromComparison,
} from "./utils/reviewSummaryMap";
import { REVIEW_FUNNEL_SUBTITLE, REVIEW_METRIC } from "./config/reviewMetricLabels";
import { useGooglePlaceMetrics } from "./hooks/useGooglePlaceMetrics";
import { useGoogleReviewMovement } from "./hooks/useGoogleReviewMovement";
import GoogleReputationWithMovement from "./components/GoogleReputationWithMovement";
import "./styles/review-intelligence.css";

const BRANCHES = ["khobar", "riyadh", "jeddah"];
const REVIEW_EVENT_SELECT =
  "event_type,employee_name,employee_role,branch_id,source_url,created_at,review_session_id,session_id";

const CHART_TOOLTIP = {
  background: "rgba(8,10,12,0.94)",
  border: "1px solid rgba(215,188,138,0.35)",
  borderRadius: 12,
  color: "#f9f9f7",
  fontSize: 12,
};

export default function ReviewIntelligence({ embedded = false }) {
  const platform = usePlatformFiltersOptional();
  const [branchLocal, setBranchLocal] = useState(defaultBranchId());
  const [rangeLocal, setRangeLocal] = useState(DEFAULT_RANGE);
  const branch = embedded && platform ? (platform.branch || defaultBranchId()) : branchLocal;
  const selectedRange = embedded && platform ? platform.selectedRange : rangeLocal;
  const setBranch = embedded && platform ? () => {} : setBranchLocal;
  const setSelectedRange = embedded && platform ? () => {} : setRangeLocal;

  const [kpis, setKpis] = useState(null);
  const [staffMerged, setStaffMerged] = useState([]);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [branchScans, setBranchScans] = useState([]);
  const [branchComparison, setBranchComparison] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [error, setError] = useState("");
  const configured = isSupabaseConfigured();
  const branchLabel = branchDisplayName(branch);
  const rangeLabel = rangeExportLabel(selectedRange);
  const { loading: googleLoading, forBranch: googleMetrics, byBranch: googleByBranch } =
    useGooglePlaceMetrics(branch);
  const { movementByBranch } = useGoogleReviewMovement({
    byBranch: googleByBranch,
    enabled: configured,
    captureOnLoad: true,
    periodRange: selectedRange,
  });
  const branchGoogleMovement = movementByBranch[branch] || null;

  const load = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const since = rangeToSince(selectedRange);
      const hours = rangeToHours(selectedRange);
      const activeBranch = embedded && platform ? platform.branch : branch;

      const summary = await fetchReviewEventsSummary(supabase, {
        branch: activeBranch || null,
        hours,
      });

      if (summary) {
        const allSummary = activeBranch
          ? await fetchReviewEventsSummary(supabase, { branch: null, hours })
          : summary;

        setKpis(kpisFromReviewSummary(summary));
        setStaffMerged(mergeStaffStats([], staffFromReviewSummary(summary)));
        setDailyTrend(dailyTrendFromReviewSummary(summary));
        const comparison = branchComparisonFromReviewSummary(allSummary || summary);
        setBranchComparison(comparison);
        setBranchScans(branchScansFromComparison(comparison));
        if (summary._note) setError(summary._note);
        return;
      }

      let reviewQ = supabase
        .from("review_events")
        .select(REVIEW_EVENT_SELECT)
        .order("created_at", { ascending: false })
        .limit(2500);

      if (activeBranch) {
        reviewQ = reviewQ.eq("branch_id", activeBranch);
      }

      let reviewAllQ = supabase
        .from("review_events")
        .select("event_type,branch_id,created_at,review_session_id,session_id")
        .order("created_at", { ascending: false })
        .limit(2000);

      if (since) {
        reviewQ = reviewQ.gte("created_at", since);
        reviewAllQ = reviewAllQ.gte("created_at", since);
      }

      const [{ data: branchEvents }, { data: allEvents }] = await Promise.all([
        reviewQ,
        reviewAllQ,
      ]);

      const events = applyPlatformFilters(branchEvents || [], embedded ? platform : null);
      const all = applyPlatformFilters(allEvents || [], embedded ? platform : null);

      setKpis(computeReviewKpis(events));
      setStaffMerged(mergeStaffStats([], aggregateStaffReviewStats(events, branch)));
      setDailyTrend(buildDailyScanTrend(events));
      setBranchScans(buildBranchScanTotals(all));
      setBranchComparison(buildBranchReviewComparison(all));
    } catch (e) {
      setError(e.message || "Failed to load review intelligence");
    } finally {
      setLoading(false);
    }
  }, [branch, selectedRange, configured, embedded, platform]);

  useEffect(() => {
    load();
  }, [load]);

  const employees = useMemo(
    () =>
      buildEmployeePerformance(
        staffMerged.map((s) => ({
          name: s.name,
          role: s.role,
          generated: s.generated,
          google_clicks: s.google,
          opens: s.scans,
        })),
      ),
    [staffMerged],
  );

  const topStaff = staffMerged[0];

  const leaderboardData = useMemo(
    () =>
      staffMerged.slice(0, 10).map((s) => ({
        name: s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name,
        scans: s.scans,
        google: s.google,
        conversion: s.conversion_pct,
      })),
    [staffMerged],
  );

  const reviewsByStaffData = useMemo(
    () =>
      staffMerged.slice(0, 8).map((s) => ({
        name: s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name,
        reviews: s.generated,
      })),
    [staffMerged],
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

  if (!configured) {
    return (
      <motion.div className="rev-intel-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <p className="rev-intel-muted">Connect Supabase to enable Review Intelligence.</p>
      </motion.div>
    );
  }

  return (
    <motion.div className={`rev-intel-wrap ${embedded ? "rev-intel-wrap--embedded" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {!embedded && (
      <header className="rev-intel-header">
        <motion.div className="rev-intel-header-top">
          <p className="rev-intel-kicker">NAC REVIEW OS</p>
          <h1>Review Intelligence</h1>
          <p className="rev-funnel-subtitle">{REVIEW_FUNNEL_SUBTITLE}</p>
          <p className="rev-intel-sub">
            {branchLabel} · {rangeLabel}
            {selectedRange === "today" ? " · 3:00 AM – 2:59 AM (Asia/Riyadh)" : ""}
          </p>
          <div className="rev-google-rep-row">
            <GoogleReputationWithMovement
              metrics={googleMetrics}
              movement={branchGoogleMovement}
              loading={googleLoading}
              showName
            />
          </div>
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
        </motion.div>
      </header>
      )}

      {error && (
        <motion.div className="rev-intel-alert">
          <AlertCircle size={16} /> {error}
        </motion.div>
      )}

      {embedded && (
        <div className="rev-google-rep-row" style={{ marginBottom: "0.75rem" }}>
          <GoogleReputationWithMovement
            metrics={googleMetrics}
            movement={branchGoogleMovement}
            loading={googleLoading}
            compact
          />
        </div>
      )}

      {loading ? (
        <p className="rev-intel-muted">Loading…</p>
      ) : (
        <>
          <motion.div className="rev-kpi-grid" layout>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>{REVIEW_METRIC.cardTaps}</span>
              <strong>{kpis?.qr_scans ?? 0}</strong>
              <small className="rev-kpi-insight">QR/NFC · {rangeLabel}</small>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>{REVIEW_METRIC.reviewInteractions}</span>
              <strong>{kpis?.reviews_generated ?? 0}</strong>
              <small className="rev-kpi-insight">Generated pages, not Google posts</small>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>{REVIEW_METRIC.googleRedirects}</span>
              <strong>{kpis?.google_redirects ?? 0}</strong>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>{REVIEW_METRIC.tapToGooglePct}</span>
              <strong>{kpis?.conversion_pct ?? 0}%</strong>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Review page opens</span>
              <strong>{kpis?.review_page_opens ?? 0}</strong>
            </motion.div>
            <motion.div className="rev-kpi-card" whileHover={{ y: -2 }}>
              <span>Unique visitors</span>
              <strong>{kpis?.unique_review_visitors ?? 0}</strong>
            </motion.div>
            {topStaff && (
              <motion.div className="rev-kpi-card rev-kpi-card--highlight" whileHover={{ y: -2 }}>
                <span>
                  <Trophy size={14} /> Top staff
                </span>
                <strong>{topStaff.name}</strong>
                <small className="rev-kpi-insight">
                  {topStaff.scans} card taps · {topStaff.conversion_pct}% to Google
                </small>
              </motion.div>
            )}
          </motion.div>

          {branchScans.length > 0 && (
            <section className="rev-section">
              <h2>
                <GitBranch size={18} /> Card taps by branch (QR/NFC)
              </h2>
              <motion.div className="rev-branch-table">
                <motion.div className="rev-branch-row head">
                  <span>Branch</span>
                  <span>Scans</span>
                </motion.div>
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
                      <th>Card taps</th>
                      <th>Page opens</th>
                      <th>Interactions</th>
                      <th>Copies</th>
                      <th>Google redirects</th>
                      <th>To Google %</th>
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
                      <Bar dataKey="scans" name="Card taps" fill="#4ecdc4" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="google" name="Google redirects" fill="#d7bc8a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {dailyTrend.length > 0 && (
              <section className="rev-section rev-chart-panel">
                <h2>
                  <TrendingUp size={18} /> Daily card tap trend
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
                  <Star size={18} /> Review interactions by staff
                </h2>
                <div className="rev-chart-box">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={reviewsByStaffData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis type="number" tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={72} tick={{ fill: "rgba(249,249,247,0.65)", fontSize: 10 }} />
                      <Tooltip contentStyle={CHART_TOOLTIP} />
                      <Bar dataKey="reviews" name="Interactions" fill="#d7bc8a" radius={[0, 4, 4, 0]} />
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
              {staffMerged.length === 0 ? (
                <p className="rev-intel-muted">No staff activity in this period yet.</p>
              ) : (
                staffMerged.map((emp) => {
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
                        <span>{emp.scans} card taps</span>
                        <span>{emp.generated} interactions</span>
                        <span>{emp.copy} copies</span>
                        <span>{emp.google} redirects</span>
                        <span>{emp.conversion_pct}% to Google</span>
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
                <span>Google rating</span>
                <span>Card taps</span>
                <span>Interactions</span>
                <span>Google redirects</span>
                <span>To Google %</span>
              </motion.div>
              {branchComparison.map((row) => (
                <div
                  key={row.branch_id}
                  className={`rev-branch-row ${row.branch_id === branch ? "rev-branch-highlight" : ""}`}
                >
                  <span>{branchDisplayName(row.branch_id)}</span>
                  <span className="rev-branch-google-cell">
                    <GoogleReputationWithMovement
                      metrics={googleByBranch[row.branch_id]}
                      movement={movementByBranch[row.branch_id]}
                      loading={googleLoading}
                      compact
                    />
                  </span>
                  <span>{row.qr_scans}</span>
                  <span>{row.reviews_generated}</span>
                  <span>{row.google_redirects}</span>
                  <span>{row.conversion_pct}%</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </motion.div>
  );
}
