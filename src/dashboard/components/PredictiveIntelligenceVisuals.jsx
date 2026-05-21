import React from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

const TIER_CLASS = {
  elite: "pred-tier--elite",
  strong: "pred-tier--strong",
  unstable: "pred-tier--unstable",
  critical: "pred-tier--critical",
};

export function TrendArrow({ value, size = 14 }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) {
    return <Minus size={size} className="pred-arrow pred-arrow--flat" aria-hidden />;
  }
  if (n > 0) {
    return <TrendingUp size={size} className="pred-arrow pred-arrow--up" aria-hidden />;
  }
  return <TrendingDown size={size} className="pred-arrow pred-arrow--down" aria-hidden />;
}

export function MomentumChip({ label, direction }) {
  const dir = (direction || "Stable").toLowerCase();
  const cls =
    dir === "rising" ? "pred-momentum--rising" : dir === "declining" ? "pred-momentum--declining" : "pred-momentum--stable";
  return (
    <span className={`pred-momentum-chip ${cls}`}>
      {label || direction}
    </span>
  );
}

export function OperationalScoreBadge({ score, tier, tierLabel, compact = false }) {
  if (score == null) {
    return <span className="pred-score pred-score--na">—</span>;
  }
  const tierClass = TIER_CLASS[tier] || "pred-tier--strong";
  return (
    <div className={`pred-score-badge ${tierClass} ${compact ? "pred-score-badge--compact" : ""}`}>
      <span className="pred-score-value">{score}</span>
      {!compact && tierLabel ? <span className="pred-score-tier">{tierLabel}</span> : null}
    </div>
  );
}

export function MicroSparkline({ values = [], width = 72, height = 22, color = "#4ecdc4" }) {
  const pts = (values || []).map((v) => Number(v) || 0);
  if (pts.length < 2) {
    return <svg width={width} height={height} className="pred-sparkline pred-sparkline--empty" />;
  }
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const span = max - min || 1;
  const step = width / (pts.length - 1);
  const coords = pts.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / span) * (height - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg width={width} height={height} className="pred-sparkline" aria-hidden>
      <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function RiskMarker({ label }) {
  if (!label) return null;
  return (
    <span className="pred-risk-marker" title={label}>
      <AlertTriangle size={12} />
      <span>{label}</span>
    </span>
  );
}

export function HealthIndicator({ tier }) {
  const cls = TIER_CLASS[tier] || "pred-tier--strong";
  return <span className={`pred-health-dot ${cls}`} aria-label={`Health ${tier}`} />;
}
