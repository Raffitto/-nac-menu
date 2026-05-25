import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { Sparkles, Target, Users, LineChart } from "lucide-react";
import { usePredictiveIntelligence } from "../hooks/usePredictiveIntelligence";
import {
  TrendArrow,
  MomentumChip,
  OperationalScoreBadge,
  MicroSparkline,
  RiskMarker,
  HealthIndicator,
} from "./PredictiveIntelligenceVisuals";
import { branchDisplayName } from "../utils/rangeState";
import { CONFIDENCE_LABELS, provisionalPhrase } from "../../platform/contracts/dataConfidence";
import ReviewNetworkIntegrityBanner from "./ReviewNetworkIntegrityBanner";
import "../styles/predictive-intelligence.css";

/**
 * Predictive operational intelligence — scores, momentum, coaching, executive insights.
 */
export default function PredictiveIntelligencePanel({
  reviewData = null,
  showBranchScores = true,
  compact = false,
}) {
  const { pkg, activeScore, loading, error } = usePredictiveIntelligence(reviewData);
  const momentum = pkg?.momentum;
  const predConf = pkg?.predictiveConfidence;
  const sparkValues = useMemo(
    () => (reviewData?.dailyTrend || []).map((d) => d.scans),
    [reviewData?.dailyTrend],
  );

  if (loading && !pkg) {
    return (
      <div className="pred-panel pred-panel--loading">
        <div className="nac-bi-skeleton" style={{ height: compact ? 120 : 200, borderRadius: 16 }} />
      </div>
    );
  }

  if (error && !pkg) {
    return (
      <div className="pred-panel pred-panel--error">
        <p>{error}</p>
      </div>
    );
  }

  if (!pkg) return null;

  return (
    <motion.section
      className={`pred-panel ${compact ? "pred-panel--compact" : ""}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <header className="pred-panel-head">
        <Sparkles size={16} className="pred-panel-icon" />
        <div>
          <h3 className="pred-panel-title">Predictive Intelligence</h3>
          <p className="pred-panel-sub">
            {predConf?.provisional
              ? provisionalPhrase(
                  predConf.level,
                  "Operational scoring from available review and menu signals",
                )
              : "Operational scoring and forward-looking signals from live data"}
          </p>
        </div>
        {activeScore?.tier ? <HealthIndicator tier={activeScore.tier} /> : null}
      </header>
      {predConf?.level ? (
        <p className="pred-muted" style={{ margin: "0 0 0.5rem", fontSize: "0.75rem" }}>
          Signal confidence: {CONFIDENCE_LABELS[predConf.level] || predConf.level}
        </p>
      ) : null}

      <ReviewNetworkIntegrityBanner integrity={reviewData?.integrity} />

      <div className="pred-panel-grid">
        <div className="pred-card pred-card--score">
          <div className="pred-card-label">
            <Target size={14} /> Branch operational score
          </div>
          {activeScore?.insufficient_data ? (
            <p className="pred-muted">{activeScore.message}</p>
          ) : (
            <>
              <OperationalScoreBadge
                score={activeScore?.score}
                tier={activeScore?.tier}
                tierLabel={activeScore?.tier_label}
              />
              {activeScore?.weaknesses?.[0] ? (
                <RiskMarker label={activeScore.weaknesses[0]} />
              ) : null}
            </>
          )}
        </div>

        <div className="pred-card pred-card--momentum">
          <div className="pred-card-label">
            <LineChart size={14} /> Review momentum
          </div>
          {momentum?.insufficient_data ? (
            <p className="pred-muted">{momentum.message}</p>
          ) : (
            <>
              <MomentumChip label={momentum?.momentum} direction={momentum?.momentum} />
              {momentum?.tonight_redirects ? (
                <p className="pred-stat">
                  {momentum.provisional
                    ? provisionalPhrase(momentum.confidence, "Estimated redirects tonight")
                    : "Expected Google redirects tonight"}
                  :{" "}
                  <strong>
                    {momentum.tonight_redirects.low}-{momentum.tonight_redirects.high}
                  </strong>
                </p>
              ) : null}
              {momentum?.monthly_review_gain != null ? (
                <p className="pred-stat">
                  Est. monthly review gain:{" "}
                  <strong>
                    <TrendArrow value={momentum.monthly_review_gain} size={12} />
                    {momentum.monthly_review_gain >= 0 ? "+" : ""}
                    {momentum.monthly_review_gain}
                  </strong>
                </p>
              ) : null}
              {momentum?.redirect_pace_vs_last_week != null ? (
                <p className="pred-stat">
                  Redirect pace vs prior:{" "}
                  <strong>
                    {momentum.redirect_pace_vs_last_week >= 0 ? "+" : ""}
                    {momentum.redirect_pace_vs_last_week}%
                  </strong>
                </p>
              ) : null}
              <MicroSparkline values={sparkValues} />
            </>
          )}
        </div>
      </div>

      {showBranchScores && pkg.branchScores?.length > 0 ? (
        <div className="pred-branch-scores">
          <p className="pred-section-label">Network branch scores</p>
          <div className="pred-branch-score-row">
            {pkg.branchScores.map((b) => (
              <div key={b.branch_id} className="pred-branch-score-item">
                <span className="pred-branch-name">{branchDisplayName(b.branch_id)}</span>
                <OperationalScoreBadge
                  score={b.score}
                  tier={b.tier}
                  tierLabel={b.tier_label}
                  compact
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {pkg.executiveInsights?.length > 0 ? (
        <div className="pred-insights-block">
          <p className="pred-section-label">Executive observations</p>
          <ul className="pred-insight-list">
            {pkg.executiveInsights.map((ins) => (
              <li key={ins.id}>{ins.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {pkg.staffInsights?.length > 0 ? (
        <div className="pred-insights-block">
          <p className="pred-section-label">
            <Users size={13} /> Staff coaching signals
          </p>
          <ul className="pred-insight-list pred-insight-list--coaching">
            {pkg.staffInsights.slice(0, compact ? 4 : 6).map((ins, i) => (
              <li key={`${ins.branch_id}-${i}`} className={ins.severity === "high" ? "pred-insight--risk" : ""}>
                {ins.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </motion.section>
  );
}
