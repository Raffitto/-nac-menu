import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Star, RefreshCw, Camera, Users, GitBranch, FileDown, AlertCircle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  fetchReviewIntelligence,
  fetchUnifiedSummary,
  fetchBranchComparison,
  generateDailySnapshot,
} from "./utils/unifiedIntelligenceApi";
import { buildEmployeePerformance } from "./engines/employeePerformanceEngine";
import { runDataQualityDiagnostics } from "./utils/dataQualityDiagnostics";
import { exportUnifiedIntelligenceXLSX } from "./engines/exportEngine";
import { getBusinessDayKey } from "./utils/businessDay";
import "./styles/review-intelligence.css";

const BRANCHES = ["khobar", "riyadh", "jeddah"];
const TIME_FILTERS = [
  { label: "Today", value: 24 },
  { label: "7D", value: 168 },
  { label: "30D", value: 720 },
];

export default function ReviewIntelligence() {
  const [branch, setBranch] = useState(
    process.env.REACT_APP_NAC_BRANCH_ID || "khobar"
  );
  const [hours, setHours] = useState(24);
  const [reviewData, setReviewData] = useState(null);
  const [unified, setUnified] = useState(null);
  const [comparison, setComparison] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [error, setError] = useState("");
  const [diag, setDiag] = useState(null);

  const configured = isSupabaseConfigured();

  const load = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [rev, uni, cmp] = await Promise.all([
        fetchReviewIntelligence(branch, hours),
        fetchUnifiedSummary(branch, getBusinessDayKey()),
        fetchBranchComparison(hours),
      ]);
      setReviewData(rev);
      setUnified(uni);
      setComparison(Array.isArray(cmp) ? cmp : []);

      const since = hours === 24 ? new Date(Date.now() - 86400000).toISOString() : null;
      let menuQ = supabase.from("menu_events").select("session_id,event_type,category_id,item_name_en,created_at").eq("branch_id", branch).limit(500);
      let reviewQ = supabase.from("review_events").select("event_type,employee_name,source_url,created_at").eq("branch_id", branch).limit(200);
      if (since) {
        menuQ = menuQ.gte("created_at", since);
        reviewQ = reviewQ.gte("created_at", since);
      }
      const [{ data: menuEvents }, { data: reviewEvents }] = await Promise.all([menuQ, reviewQ]);
      setDiag(runDataQualityDiagnostics({ menuEvents: menuEvents || [], reviewEvents: reviewEvents || [], branchId: branch }));
    } catch (e) {
      setError(e.message || "Failed to load review intelligence");
    } finally {
      setLoading(false);
    }
  }, [branch, hours, configured]);

  useEffect(() => {
    load();
  }, [load]);

  const employees = useMemo(
    () => buildEmployeePerformance(reviewData?.top_employees || []),
    [reviewData]
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

  const handleExport = () => {
    exportUnifiedIntelligenceXLSX({
      review: reviewData,
      unified,
      comparison,
      employees,
      diagnostics: diag,
    });
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
        <motion.div initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <p className="rev-intel-kicker">NAC REVIEW OS</p>
          <h1>Review Intelligence</h1>
          <p className="rev-intel-sub">Unified review + menu + sales attribution</p>
        </motion.div>
        <motion.div className="rev-intel-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="glass-pill rev-select">
            {BRANCHES.map((b) => (
              <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>
            ))}
          </select>
          <motion.div className="rev-time-pills">
            {TIME_FILTERS.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`glass-pill ${hours === t.value ? "active" : ""}`}
                onClick={() => setHours(t.value)}
              >
                {t.label}
              </button>
            ))}
          </motion.div>
          <button type="button" className="glass-pill" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "nac-bi-spin" : ""} />
          </button>
          <button type="button" className="glass-pill" onClick={handleSnapshot} disabled={snapshotBusy}>
            <Camera size={14} /> Snapshot
          </button>
          <button type="button" className="glass-pill" onClick={handleExport}>
            <FileDown size={14} /> Export
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
              <span>Menu sessions (day)</span>
              <strong>{unified?.sessions ?? 0}</strong>
            </motion.div>
          </div>

          <section className="rev-section">
            <h2><Users size={18} /> Employee performance</h2>
            <motion.div className="rev-emp-grid">
              {employees.length === 0 ? (
                <p className="rev-intel-muted">No employee-tagged review events yet.</p>
              ) : (
                employees.map((emp) => (
                  <motion.div key={emp.name} className="rev-emp-card" whileHover={{ scale: 1.01 }}>
                    <div className="rev-emp-top">
                      <strong>{emp.name}</strong>
                      <span className="rev-badge">{emp.classification.label}</span>
                    </div>
                    <p className="rev-emp-role">{emp.role || "Staff"}</p>
                    <p className="rev-emp-reason">{emp.classification.reason}</p>
                    <div className="rev-emp-metrics">
                      <span>{emp.metrics.reviews_generated} reviews</span>
                      <span>{emp.metrics.review_conversion_pct}% Google</span>
                      <span className="rev-conf">{emp.metrics.confidence}</span>
                    </div>
                  </motion.div>
                ))
              )}
            </motion.div>
          </section>

          <section className="rev-section">
            <h2><GitBranch size={18} /> Cross-branch comparison</h2>
            <div className="rev-branch-table">
              <div className="rev-branch-row head">
                <span>Branch</span>
                <span>Sessions</span>
                <span>Visual conv.</span>
                <span>Reviews</span>
                <span>Sales</span>
              </div>
              {comparison.map((row) => (
                <div key={row.branch_id} className="rev-branch-row">
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
              <h2><Star size={18} /> Data quality</h2>
              <p className={`rev-dq-status ${diag.healthy ? "ok" : "warn"}`}>
                {diag.healthy ? "Healthy" : `${diag.issue_count} issue(s) detected`}
              </p>
              <ul className="rev-dq-list">
                {diag.issues.map((i) => (
                  <li key={i.code}>{i.message}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </motion.div>
  );
}
