import React from "react";
import { motion } from "framer-motion";

const TIER_STROKE = {
  elite: "#d7bc8a",
  strong: "#4ecdc4",
  unstable: "#e6a841",
  critical: "#dc5a50",
  calibrating: "rgba(215, 188, 138, 0.55)",
};

export default function ExecutiveScoreRing({
  score,
  tier,
  label,
  size = 120,
  calibrating = false,
}) {
  const value = score != null && !calibrating ? Math.min(100, Math.max(0, score)) : null;
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const offset = value != null ? c - (value / 100) * c : c;
  const stroke = calibrating
    ? TIER_STROKE.calibrating
    : TIER_STROKE[tier] || "#4ecdc4";

  return (
    <div
      className={`ecc-score-ring ${calibrating ? "ecc-score-ring--calibrating" : ""}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="6"
        />
        {calibrating ? (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${c * 0.22} ${c * 0.12}`}
            animate={{ rotate: 360 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ filter: `drop-shadow(0 0 6px ${stroke})` }}
          />
        ) : null}
        {value != null ? (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ filter: `drop-shadow(0 0 8px ${stroke}55)` }}
          />
        ) : null}
      </svg>
      <div className="ecc-score-ring-center">
        <span className="ecc-score-ring-value">
          {calibrating ? "…" : value != null ? value : "—"}
        </span>
        {label ? <span className="ecc-score-ring-label">{label}</span> : null}
      </div>
    </div>
  );
}
