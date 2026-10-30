import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { Crown } from "lucide-react";
import { branchDisplayName } from "../utils/rangeState";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useReviewIntelligenceData } from "../hooks/useReviewIntelligenceData";
import { useGooglePlaceMetrics } from "../hooks/useGooglePlaceMetrics";
import GoogleReputationBadge from "../components/GoogleReputationBadge";
import { usePredictiveIntelligence } from "../hooks/usePredictiveIntelligence";
import { BRANCH_OPTIONS } from "../../platform/engines/branchIdentityEngine";
import { OperationalScoreBadge } from "../components/PredictiveIntelligenceVisuals";
import "../styles/predictive-intelligence.css";

export default function BranchBattle() {
  const filters = usePlatformFiltersOptional();
  const reviewData = useReviewIntelligenceData();
  const { branchComparison: rows, loading } = reviewData;
  const { loading: googleLoading, byBranch: googleByBranch } = useGooglePlaceMetrics(null);

  const leaderId = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.qr_scans - a.qr_scans);
    return sorted[0]?.branch_id;
  }, [rows]);

  const maxScans = useMemo(() => Math.max(...rows.map((r) => r.qr_scans), 1), [rows]);

  const reviewDataForPredictive = useMemo(
    () => ({
      branchComparison: rows,
      selectedRange: filters?.selectedRange,
      loading,
      filterKey: filters?.filterKey,
    }),
    [rows, loading, filters?.selectedRange, filters?.filterKey],
  );
  const { pkg } = usePredictiveIntelligence(reviewDataForPredictive);

  if (loading) {
    return (
      <div className="nac-branch-battle-grid">
        {BRANCH_OPTIONS.map((b) => (
          <motion.div key={b.id} className="nac-bi-skeleton" style={{ height: 140, borderRadius: 18 }} />
        ))}
      </div>
    );
  }

  if (reviewData.error || reviewData.partial) {
    return <p role="alert" className="nac-empty-state">Complete Branch Battle totals are unavailable. {reviewData.error || "Please retry."}</p>;
  }

  return (
    <div className="nac-branch-battle-grid">
      {rows.map((row, i) => {
        const isLeader = row.branch_id === leaderId && row.qr_scans > 0;
        const pct = Math.round((row.qr_scans / maxScans) * 100);
        const branchScore = pkg?.scoreByBranch?.[row.branch_id];
        return (
          <motion.div
            key={row.branch_id}
            className={`nac-branch-battle-card ${isLeader ? "leader" : ""}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            {isLeader && <Crown size={20} className="nac-branch-crown" />}
            {branchScore?.score != null && !branchScore.insufficient_data ? (
              <OperationalScoreBadge
                score={branchScore.score}
                tier={branchScore.tier}
                tierLabel={branchScore.tier_label}
                compact
              />
            ) : null}
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 500 }}>
              {branchDisplayName(row.branch_id)}
            </h3>
            <div className="nac-branch-google-rep">
              <GoogleReputationBadge
                metrics={googleByBranch[row.branch_id]}
                loading={googleLoading}
                compact
              />
            </div>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "rgba(249,249,247,0.5)" }}>
              Rank #{rows.findIndex((r) => r.branch_id === row.branch_id) + 1}
            </p>
            <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div>
                <p style={{ margin: 0, fontSize: "0.65rem", color: "rgba(249,249,247,0.45)" }}>Scans</p>
                <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 500 }}>{row.qr_scans}</p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: "0.65rem", color: "rgba(249,249,247,0.45)" }}>Conversion</p>
                <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 500 }}>{row.conversion_pct}%</p>
              </div>
            </div>
            <div className="nac-branch-bar">
              <motion.div
                className="nac-branch-bar-fill"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.72rem", color: "rgba(249,249,247,0.45)" }}>
              {row.qr_scans} card taps · {row.reviews_generated} interactions · {row.google_redirects} redirects
            </p>
          </motion.div>
        );
      })}
    </div>
  );
}
