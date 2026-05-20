import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Shield, RefreshCw, Swords, TrendingUp } from "lucide-react";
import { useCompetitiveReputation } from "../hooks/useCompetitiveReputation";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { branchDisplayName } from "../utils/rangeState";
import {
  formatGoogleRating,
  formatGoogleReviewCount,
} from "../services/googlePlacesService";
import { COMPETITOR_BRANCHES } from "../config/competitors";
import "../styles/competitive-reputation.css";

function toneClass(tone) {
  return `cr-tone-${tone || "amber"}`;
}

function MetricBar({ label, leftVal, rightVal, leftLabel, rightLabel, tone = "neutral" }) {
  const max = Math.max(Number(leftVal) || 0, Number(rightVal) || 0, 1);
  const leftPct = ((Number(leftVal) || 0) / max) * 100;
  const rightPct = ((Number(rightVal) || 0) / max) * 100;
  return (
    <div className="cr-metric-bar">
      <div className="cr-metric-bar-head">
        <span>{label}</span>
        <span className="cr-metric-bar-vals">
          {leftLabel} vs {rightLabel}
        </span>
      </div>
      <div className="cr-metric-bar-tracks">
        <div className={`cr-bar-track cr-bar-nac ${toneClass(tone)}`}>
          <motion.div
            className="cr-bar-fill"
            initial={{ width: 0 }}
            animate={{ width: `${leftPct}%` }}
            transition={{ duration: 0.6 }}
          />
        </div>
        <div className="cr-bar-track cr-bar-comp">
          <motion.div
            className="cr-bar-fill"
            initial={{ width: 0 }}
            animate={{ width: `${rightPct}%` }}
            transition={{ duration: 0.6, delay: 0.05 }}
          />
        </div>
      </div>
    </div>
  );
}

function CompetitorCard({ nac, competitor }) {
  const rating = formatGoogleRating(competitor.metrics?.rating);
  const reviews = formatGoogleReviewCount(competitor.metrics?.totalReviews);
  const nacRating = formatGoogleRating(nac.rating);
  const gap =
    competitor.threat?.ratingGap != null
      ? `${competitor.threat.ratingGap > 0 ? "+" : ""}${competitor.threat.ratingGap}★`
      : "—";

  return (
    <motion.article
      className={`cr-competitor-card ${toneClass(competitor.tone)}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="cr-comp-top">
        <div>
          <h4>{competitor.displayName || competitor.name}</h4>
          <p className="cr-comp-meta">
            {competitor.category} · {competitor.distance}
          </p>
          <p className="cr-comp-type">{competitor.type} · {competitor.socialMood || competitor.outingPurpose || "Same guest wallet"}</p>
        </div>
        <span className={`cr-threat-pill ${toneClass(competitor.tone)}`}>
          Threat: {competitor.threat?.label || "Watch"}
        </span>
      </div>

      <div className="cr-comp-metrics">
        <div className="cr-comp-line">
          <span className="cr-comp-rating">{rating ? `★ ${rating}` : "—"}</span>
          <span className="cr-comp-reviews">{reviews}</span>
        </div>
        <p className="cr-comp-gap">
          vs NAC {nacRating ? `★ ${nacRating}` : "—"} · gap {gap}
          {competitor.threat?.reviewGap != null && (
            <> · {competitor.threat.reviewGap > 0 ? "+" : ""}{competitor.threat.reviewGap.toLocaleString()} reviews</>
          )}
        </p>
      </div>

      {competitor.metrics?.rating != null && (
        <>
          <MetricBar
            label="Rating"
            leftVal={nac.rating}
            rightVal={competitor.metrics.rating}
            leftLabel="NAC"
            rightLabel={competitor.name}
            tone={competitor.tone}
          />
          <MetricBar
            label="Review volume"
            leftVal={nac.totalReviews}
            rightVal={competitor.metrics.totalReviews}
            leftLabel="NAC"
            rightLabel={competitor.name}
            tone={competitor.tone}
          />
        </>
      )}

      {competitor.metrics?.error === "missing_place_id" && (
        <p className="cr-comp-pending">Add Google Place ID in competitors.js to activate live tracking.</p>
      )}

      <p className="cr-momentum">
        <TrendingUp size={12} /> Momentum: tracking soon
      </p>
    </motion.article>
  );
}

function BranchBattlefield({ branchIntel }) {
  const { nac, competitors, narrative, battlefield } = branchIntel;
  const nacRating = formatGoogleRating(nac.rating);

  return (
    <section className="cr-branch-panel">
      <header className="cr-branch-head">
        <div>
          <h3>{branchIntel.branchLabel}</h3>
          <p className="cr-branch-sub">Curated luxury competitive set · same guest psychology</p>
        </div>
        <div className={`cr-nac-pill ${toneClass(battlefield.ratingLeads === 0 ? "gold" : "amber")}`}>
          <span className="cr-nac-rating">{nacRating ? `★ ${nacRating}` : "—"}</span>
          <span>{formatGoogleReviewCount(nac.totalReviews)}</span>
        </div>
      </header>

      {narrative?.length > 0 && (
        <div className="cr-narrative">
          {narrative.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      <div className="cr-battlefield-stats">
        <span>{battlefield.trackedLive}/{battlefield.competitorCount} live</span>
        <span>Top pressure: {battlefield.topThreatName}</span>
        <span>{battlefield.ratingLeads} rating lead(s) vs NAC</span>
      </div>

      <div className="cr-competitor-grid">
        {competitors.map((c) => (
          <CompetitorCard key={c.id} nac={nac} competitor={c} />
        ))}
      </div>
    </section>
  );
}

export default function CompetitiveReputationWatch() {
  const platform = usePlatformFiltersOptional();
  const [branchLocal, setBranchLocal] = useState("");
  const focusBranch = platform?.branch || branchLocal || null;

  const { loading, data, error, refresh } = useCompetitiveReputation(
    focusBranch || null,
  );

  const branches = useMemo(() => data?.branches || [], [data]);

  return (
    <div className="cr-watch">
      <header className="cr-watch-header">
        <div>
          <p className="cr-kicker">
            <Swords size={14} /> Phase 13 · Competitive Intelligence
          </p>
          <h2>Competitive Reputation Watch</h2>
          <p className="cr-watch-sub">
            Hospitality war room — brands competing for the same mood, wallet, and social trust
          </p>
        </div>
        <div className="cr-watch-actions">
          {!platform?.branch && (
            <select
              className="cr-branch-select"
              value={branchLocal}
              onChange={(e) => setBranchLocal(e.target.value)}
              aria-label="Branch focus"
            >
              <option value="">All branches</option>
              {COMPETITOR_BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {branchDisplayName(b)} focus
                </option>
              ))}
            </select>
          )}
          <button type="button" className="cr-refresh-btn" onClick={refresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? "nac-bi-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      {data?.networkNarrative && !focusBranch && (
        <div className="cr-network-callout">
          <Shield size={16} />
          <p>{data.networkNarrative}</p>
        </div>
      )}

      {error && (
        <p className="cr-error">{error}</p>
      )}

      {loading && (
        <div className="cr-loading-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="nac-bi-skeleton" style={{ height: 220, borderRadius: 16 }} />
          ))}
        </div>
      )}

      {!loading && !error && branches.map((b) => (
        <BranchBattlefield key={b.branchId} branchIntel={b} />
      ))}

      {!loading && focusBranch && (
        <p className="cr-hint">Focused on {branchDisplayName(focusBranch)} · clear branch filter for network battlefield.</p>
      )}
    </div>
  );
}
