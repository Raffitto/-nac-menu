import React, { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Crown,
  Activity,
  AlertTriangle,
  TrendingUp,
  Users,
  Download,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { useExecutiveCommandCenter } from "../hooks/useExecutiveCommandCenter";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useReviewExports } from "../reviews/useReviewExports";
import ExecutiveScoreRing from "../components/executive/ExecutiveScoreRing";
import { MomentumChip, TrendArrow } from "../components/PredictiveIntelligenceVisuals";
import { sortHeatmapRows } from "../engines/executiveHeatmapEngine";
import { branchDisplayName, rangeExportLabel } from "../utils/rangeState";
import PlatformStatusBanner from "../components/PlatformStatusBanner";
import OperationalTrustBadge from "../components/OperationalTrustBadge";
import { useMenuBiDashboardContextOptional } from "../context/MenuBiDashboardContext";
import { useRbacOptional } from "../context/RbacContext";
import {
  commandCenterPulseTitle,
  commandCenterHeatmapEmptyCopy,
} from "../../lib/rbacIntelligenceScope";
import BoardroomMode, { BoardroomLaunchButton } from "../components/BoardroomMode";
import { isTenantFeatureEnabled } from "../../config/tenantConfig";
import "../styles/executive-command-center.css";

const SEVERITY_CLASS = {
  critical: "ecc-alert--critical",
  risk: "ecc-alert--risk",
  watch: "ecc-alert--watch",
  info: "ecc-alert--info",
};

const HEALTH_CLASS = {
  healthy: "ecc-health--healthy",
  watch: "ecc-health--watch",
  risk: "ecc-health--risk",
  critical: "ecc-health--critical",
};

function heatCellClass(value) {
  if (value == null) return "ecc-heat-cell--na";
  if (value >= 75) return "ecc-heat-cell--high";
  if (value >= 55) return "ecc-heat-cell--mid";
  if (value >= 35) return "ecc-heat-cell--low";
  return "ecc-heat-cell--risk";
}

function CommandCenterTrustBadge() {
  const ctx = useMenuBiDashboardContextOptional();
  return <OperationalTrustBadge trust={ctx?.operationalTrust} className="ecc-trust-badge" />;
}

export default function ExecutiveCommandCenter() {
  const { pkg, loading, error, selectedRange, reviewData } = useExecutiveCommandCenter();
  const rbac = useRbacOptional();
  const filters = usePlatformFiltersOptional();
  const pulseTitle = useMemo(
    () => commandCenterPulseTitle(rbac?.profile),
    [rbac?.profile],
  );
  const { exportExecutiveSummaryPdf, busy } = useReviewExports(filters);
  const [sortCol, setSortCol] = useState("operational_score");
  const [sortDir, setSortDir] = useState("desc");
  const [boardroomOpen, setBoardroomOpen] = useState(false);

  const heatmapRows = useMemo(() => {
    if (!pkg?.heatmap?.rows) return [];
    return sortHeatmapRows(pkg.heatmap.rows, sortCol, sortDir);
  }, [pkg, sortCol, sortDir]);

  const toggleSort = useCallback(
    (colId) => {
      if (sortCol === colId) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      else {
        setSortCol(colId);
        setSortDir("desc");
      }
    },
    [sortCol],
  );

  if (loading && !pkg) {
    return (
      <div className="ecc-wrap ecc-wrap--loading">
        <div className="nac-bi-skeleton" style={{ height: 320, borderRadius: 20 }} />
      </div>
    );
  }

  if (error && !pkg) {
    return (
      <div className="ecc-wrap ecc-wrap--error">
        <p>{error}</p>
      </div>
    );
  }

  if (!pkg) return null;

  const brief = pkg.dailyBrief;
  const momentum = pkg.momentum;
  const buildingBaseline = pkg.networkScoreBuilding || pkg.pulse?.building_baseline;
  const scoreCalibrating = buildingBaseline || pkg.networkScore == null;
  const ns = pkg.networkScore;
  const networkTier =
    scoreCalibrating
      ? "unstable"
      : ns >= 90
        ? "elite"
        : ns >= 75
          ? "strong"
          : ns >= 60
            ? "unstable"
            : "critical";

  return (
    <>
    <motion.div
      className="ecc-wrap"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <PlatformStatusBanner platformStatus={reviewData?.platformStatus} className="ecc-platform-status" />
      <header className="ecc-hero">
        <div className="ecc-hero-copy">
          <p className="ecc-kicker">
            <Crown size={14} /> Executive Command Center
          </p>
          <h2 className="ecc-title">{pulseTitle}</h2>
          <p className="ecc-sub">
            {rangeExportLabel(selectedRange)} · Real-time leadership view · {pkg.pulse?.live_label}
          </p>
        </div>
        <div className="ecc-hero-actions">
          <CommandCenterTrustBadge />
          {isTenantFeatureEnabled("boardroomMode") ? (
            <BoardroomLaunchButton onLaunch={() => setBoardroomOpen(true)} />
          ) : null}
          <button
            type="button"
            className="ecc-export-btn"
            disabled={busy.executive}
            onClick={() => exportExecutiveSummaryPdf?.()}
          >
            <Download size={14} className={busy.executive ? "nac-bi-spin" : ""} />
            {busy.executive ? "Exporting…" : "Executive Summary PDF"}
          </button>
        </div>
        <div className="ecc-hero-score">
          <ExecutiveScoreRing
            score={scoreCalibrating ? null : pkg.networkScore}
            tier={networkTier}
            calibrating={scoreCalibrating}
            label={
              scoreCalibrating
                ? pkg.pulse?.has_scored_branch
                  ? "Calibrating"
                  : "Insufficient operational history"
                : "Network score"
            }
            size={128}
          />
        </div>
      </header>

      <div className="ecc-kpi-strip">
        <motion.div className="ecc-kpi ecc-kpi--glow" layout>
          <span className="ecc-kpi-label">Review momentum</span>
          {momentum?.insufficient_data ? (
            <span className="ecc-kpi-muted">Insufficient data</span>
          ) : (
            <MomentumChip label={momentum.momentum} direction={momentum.momentum} />
          )}
        </motion.div>
        <motion.div className="ecc-kpi ecc-kpi--glow" layout>
          <span className="ecc-kpi-label">Google redirects (period)</span>
          <strong className="ecc-kpi-value">{pkg.pulse?.total_redirects ?? 0}</strong>
          {pkg.pulse?.redirect_pace_pct != null ? (
            <span className="ecc-kpi-delta">
              <TrendArrow value={pkg.pulse.redirect_pace_pct} size={12} />
              {pkg.pulse.redirect_pace_pct >= 0 ? "+" : ""}
              {pkg.pulse.redirect_pace_pct}% vs prior
            </span>
          ) : null}
        </motion.div>
        <motion.div className="ecc-kpi ecc-kpi--glow" layout>
          <span className="ecc-kpi-label">Active staff (network)</span>
          <strong className="ecc-kpi-value">{pkg.pulse?.active_staff_count ?? 0}</strong>
          {(pkg.pulse?.active_staff_count ?? 0) === 0 && (pkg.pulse?.total_redirects ?? 0) === 0 ? (
            <span className="ecc-kpi-muted">Staff activity appears after redirect history builds.</span>
          ) : null}
        </motion.div>
        <motion.div className="ecc-kpi ecc-kpi--glow" layout>
          <span className="ecc-kpi-label">Est. monthly review gain</span>
          {momentum?.monthly_review_gain != null && !momentum.insufficient_data ? (
            <strong className="ecc-kpi-value">
              {momentum.monthly_review_gain >= 0 ? "+" : ""}
              {momentum.monthly_review_gain}
            </strong>
          ) : (
            <span className="ecc-kpi-muted">Building baseline</span>
          )}
        </motion.div>
        <motion.div className="ecc-kpi ecc-kpi--pulse" layout>
          <Activity size={16} className="ecc-pulse-icon" />
          <span className="ecc-kpi-label">Live pulse</span>
          <span className="ecc-pulse-dot" aria-hidden />
          <span className="ecc-kpi-muted">{pkg.pulse?.live_label}</span>
        </motion.div>
      </div>

      <div className="ecc-grid-2">
        <section className="ecc-panel ecc-panel--brief">
          <h3 className="ecc-panel-title">Daily executive brief</h3>
          <dl className="ecc-brief-list">
            <div>
              <dt>Strongest branch</dt>
              <dd>{brief?.strongest_branch}</dd>
            </div>
            <div>
              <dt>Weakest branch</dt>
              <dd>{brief?.weakest_branch}</dd>
            </div>
            <div>
              <dt>Momentum</dt>
              <dd>{brief?.momentum_summary}</dd>
            </div>
            <div>
              <dt>Coaching focus</dt>
              <dd>{brief?.coaching_focus}</dd>
            </div>
            <div>
              <dt>Review growth</dt>
              <dd>{brief?.network_review_growth}</dd>
            </div>
            <div>
              <dt>Operational concern</dt>
              <dd className="ecc-brief-concern">{brief?.operational_concern}</dd>
            </div>
            <div className="ecc-brief-focus">
              <dt>Recommended focus</dt>
              <dd>{brief?.recommended_focus}</dd>
            </div>
          </dl>
          {brief?.top_performer_today ? (
            <p className="ecc-top-performer">
              <TrendingUp size={14} /> Top performer today: {brief.top_performer_today}
            </p>
          ) : null}
        </section>

        <section className="ecc-panel ecc-panel--alerts">
          <h3 className="ecc-panel-title">
            <AlertTriangle size={15} /> Risk alerts
          </h3>
          {pkg.alerts?.length ? (
            <ul className="ecc-alert-list">
              {pkg.alerts.map((a) => (
                <li key={a.id} className={`ecc-alert ${SEVERITY_CLASS[a.severity] || ""}`}>
                  <span className="ecc-alert-sev">{a.severity}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ecc-muted">No active alerts for this period.</p>
          )}
        </section>
      </div>

      <section className="ecc-panel">
        <h3 className="ecc-panel-title">
          <Users size={15} /> Live network status
        </h3>
        <div className="ecc-branch-grid">
          {pkg.branchStatus?.map((b, i) => (
            <motion.article
              key={b.branch_id}
              className={`ecc-branch-card ${HEALTH_CLASS[b.health?.id] || ""}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <span className={`ecc-branch-pulse ecc-branch-pulse--${b.pulse}`} aria-hidden />
              <header className="ecc-branch-card-head">
                <h4>{b.branch_name}</h4>
                <span className={`ecc-health-badge ${HEALTH_CLASS[b.health?.id] || ""}`}>
                  {b.health?.label || "Watch"}
                </span>
              </header>
              <div className="ecc-branch-metrics">
                <div>
                  <span>Score</span>
                  <strong>
                    {b.insufficient_data
                      ? "—"
                      : b.operational_score != null
                        ? `${b.operational_score}${b.provisional ? "*" : ""}`
                        : "—"}
                  </strong>
                </div>
                <div>
                  <span>Momentum</span>
                  <MomentumChip label={b.momentum} direction={b.momentum} />
                </div>
                <div>
                  <span>Redirects</span>
                  <strong>{b.google_redirects}</strong>
                </div>
                <div>
                  <span>Participation</span>
                  <strong>{b.participation_breadth}%</strong>
                </div>
                <div>
                  <span>Engagement</span>
                  <strong>{b.staff_engagement}</strong>
                </div>
                <div>
                  <span>Review growth</span>
                  <strong>
                    {b.review_growth != null
                      ? `${b.review_growth >= 0 ? "+" : ""}${b.review_growth}`
                      : "n/a"}
                  </strong>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      <div className="ecc-grid-2">
        <section className="ecc-panel">
          <h3 className="ecc-panel-title">
            {heatmapRows.length <= 1 ? "Branch operational matrix" : "Network heatmap"}
          </h3>
          {commandCenterHeatmapEmptyCopy(
            rbac?.profile,
            heatmapRows.length,
            pkg.heatmap?.mode,
          ) ? (
            <p className="ecc-empty-intel">
              {commandCenterHeatmapEmptyCopy(rbac?.profile, heatmapRows.length, pkg.heatmap?.mode)}
            </p>
          ) : null}
          {pkg.heatmap?.mode === "single" && heatmapRows[0]?.operational ? (
            <div className="ecc-single-branch-state">
              <div className="ecc-single-branch-metric">
                <span>Operational score</span>
                <strong>{heatmapRows[0].operational.score ?? "—"}</strong>
              </div>
              <div className="ecc-single-branch-metric">
                <span>Momentum</span>
                <strong>{heatmapRows[0].operational.momentum}</strong>
              </div>
              <div className="ecc-single-branch-metric">
                <span>Redirects</span>
                <strong>{heatmapRows[0].operational.redirects}</strong>
              </div>
              <div className="ecc-single-branch-metric">
                <span>Participation</span>
                <strong>{heatmapRows[0].operational.participation}%</strong>
              </div>
              <div className="ecc-single-branch-metric">
                <span>Health</span>
                <strong>{heatmapRows[0].operational.health}</strong>
              </div>
            </div>
          ) : (
          <div className="ecc-heatmap-wrap">
            <table className="ecc-heatmap">
              <thead>
                <tr>
                  <th>Branch</th>
                  {pkg.heatmap?.columns?.map((col) => (
                    <th key={col.id}>
                      <button
                        type="button"
                        className="ecc-sort-btn"
                        onClick={() => toggleSort(col.id)}
                      >
                        {col.label}
                        {sortCol === col.id ? (
                          sortDir === "desc" ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronUp size={12} />
                          )
                        ) : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapRows.map((row) => (
                  <tr key={row.branch_id}>
                    <td className="ecc-heat-branch">{row.branch_name}</td>
                    {pkg.heatmap.columns.map((col) => {
                      const v = row.cells[col.id];
                      return (
                        <td key={col.id}>
                          <span
                            className={`ecc-heat-cell ${heatCellClass(v)}`}
                            title={v != null ? String(v) : "N/A"}
                          >
                            {v != null ? v : "—"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </section>

        <section className="ecc-panel">
          <h3 className="ecc-panel-title">Executive timeline</h3>
          <ol className="ecc-timeline">
            {pkg.timeline?.map((ev, i) => (
              <li key={`${ev.time}-${i}`} className={`ecc-timeline-item ecc-timeline--${ev.kind}`}>
                <time>{ev.time}</time>
                <span>{ev.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {pkg.rankings?.length > 0 ? (
        <section className="ecc-panel ecc-panel--rankings">
          <h3 className="ecc-panel-title">Branch rankings</h3>
          <div className="ecc-rank-row">
            {pkg.rankings.map((r, i) => (
              <div key={r.branch_id} className="ecc-rank-item">
                <span className="ecc-rank-num">#{i + 1}</span>
                <span className="ecc-rank-name">{branchDisplayName(r.branch_id)}</span>
                <span className="ecc-rank-score">{r.operational_score ?? "—"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </motion.div>
    {boardroomOpen ? (
      <BoardroomMode
        commandPackage={pkg}
        rangeLabel={rangeExportLabel(selectedRange)}
        onClose={() => setBoardroomOpen(false)}
      />
    ) : null}
    </>
  );
}
