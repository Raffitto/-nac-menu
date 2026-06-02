import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  buildMenuFunnelStageMetrics,
  buildReviewFunnelStageMetrics,
} from "../../lib/operationalMetricsIntegrity";

const MENU_STAGE_DEFS = [
  { key: "qr_scans", label: "QR Scan", icon: "📱" },
  { key: "category_opens", label: "Category Open", icon: "📂" },
  { key: "item_opens", label: "Item Open", icon: "🍽" },
  { key: "addon_clicks", label: "Add-on Interaction", icon: "➕" },
];

const REVIEW_STAGE_DEFS = [
  { key: "review_redirect", label: "Review Redirect", icon: "⭐" },
  { key: "google_review_open", label: "Google Review Open", icon: "🔗" },
];

/** Legacy menu-only funnel (time spent / exit) — not used on unified operational dashboard. */
export const LEGACY_FUNNEL_STAGES = [
  { key: "time_spent", label: "Time Spent", icon: "⏱" },
  { key: "exits", label: "Exit", icon: "👋" },
];

const BAR_COLORS_MENU = ["#4a6d76", "#5a7f85", "#7a9a7e", "#a3ad7a"];
const BAR_COLORS_REVIEW = ["#c4b07f", "#d7bc8a"];

function mapStages(defs, computed, colors) {
  return defs.map((s, i) => {
    const m = computed[i] || {};
    return {
      ...s,
      value: Number(m.value) || 0,
      widthPct: m.widthPct ?? 0,
      convPct: m.convPct,
      dropPct: m.dropPct,
      convNote: m.convNote || "entry",
      barColor: colors[i] || colors[colors.length - 1],
    };
  });
}

function FunnelSection({ title, subtitle, stages }) {
  const allZero = stages.every((s) => s.value === 0);
  if (allZero) return null;

  return (
    <div className="nac-bi-funnel-section">
      <p className="nac-bi-funnel-section-title">{title}</p>
      {subtitle ? <p className="bi-table-sub nac-bi-funnel-section-sub">{subtitle}</p> : null}
      <div className="nac-bi-funnel-v2">
        {stages.map((stage, i) => (
          <React.Fragment key={stage.key}>
            <motion.div
              className="nac-bi-fv2-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.35 }}
              whileHover={{ y: -3, boxShadow: "0 8px 30px rgba(0,0,0,0.3)" }}
            >
              <div className="nac-bi-fv2-top">
                <span className="nac-bi-fv2-icon">{stage.icon}</span>
                <span className="nac-bi-fv2-label">{stage.label}</span>
              </div>
              <div className="nac-bi-fv2-count">{stage.value.toLocaleString()}</div>
              <div className="nac-bi-fv2-bar-track">
                <motion.div
                  className="nac-bi-fv2-bar-fill"
                  style={{ background: stage.barColor }}
                  initial={{ width: 0 }}
                  animate={{ width: `${stage.widthPct}%` }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                />
              </div>
              {stage.convPct != null && (
                <div className="nac-bi-fv2-pcts">
                  <span style={{ color: "#76d69f" }}>{stage.convPct.toFixed(0)}%</span>
                  <span style={{ color: "rgba(249,249,247,0.3)" }}> · </span>
                  <span style={{ color: "rgba(249,249,247,0.4)" }}>
                    {stage.convNote === "step" && stage.dropPct != null
                      ? `↓${stage.dropPct.toFixed(0)}%`
                      : stage.convNote}
                  </span>
                </div>
              )}
              {stage.convPct == null && (
                <div className="nac-bi-fv2-pcts">
                  <span style={{ color: "rgba(249,249,247,0.35)" }}>entry</span>
                </div>
              )}
            </motion.div>
            {i < stages.length - 1 && (
              <div className="nac-bi-fv2-arrow">
                <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
                  <path
                    d="M1 7h14M12 2l5 5-5 5"
                    stroke="rgba(249,249,247,0.2)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function FunnelChart({
  funnel,
  stageMetrics: stageMetricsProp,
  menuStages: menuStagesProp,
  reviewStages: reviewStagesProp,
}) {
  const menuComputed = useMemo(() => {
    if (menuStagesProp) return menuStagesProp;
    if (stageMetricsProp?.menu) return stageMetricsProp.menu;
    return buildMenuFunnelStageMetrics(funnel || {});
  }, [funnel, stageMetricsProp, menuStagesProp]);

  const reviewComputed = useMemo(() => {
    if (reviewStagesProp) return reviewStagesProp;
    if (stageMetricsProp?.review) return stageMetricsProp.review;
    return buildReviewFunnelStageMetrics(funnel || {});
  }, [funnel, stageMetricsProp, reviewStagesProp]);

  const menuStages = useMemo(
    () => mapStages(MENU_STAGE_DEFS, menuComputed, BAR_COLORS_MENU),
    [menuComputed],
  );
  const reviewStages = useMemo(
    () => mapStages(REVIEW_STAGE_DEFS, reviewComputed, BAR_COLORS_REVIEW),
    [reviewComputed],
  );

  const allZero =
    menuStages.every((s) => s.value === 0) && reviewStages.every((s) => s.value === 0);

  if (allZero) {
    return (
      <div style={{ padding: "24px 0", color: "rgba(249,249,247,0.4)", fontSize: 13, textAlign: "center" }}>
        No funnel data yet
      </div>
    );
  }

  return (
    <div className="nac-bi-funnel-sections">
      <FunnelSection
        title="Menu journey"
        subtitle="Unique sessions at each step · drop-off between steps"
        stages={menuStages}
      />
      <FunnelSection
        title="Review funnel"
        subtitle="Review experience (separate path — not a sequential menu step)"
        stages={reviewStages}
      />
    </div>
  );
}
