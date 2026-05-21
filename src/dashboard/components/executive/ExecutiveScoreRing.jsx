import React from "react";
import { motion } from "framer-motion";

const TIER_STROKE = {
  elite: "#d7bc8a",
  strong: "#4ecdc4",
  unstable: "#e6a841",
  critical: "#dc5a50",
};

export default function ExecutiveScoreRing({ score, tier, label, size = 120 }) {
  const value = score != null ? Math.min(100, Math.max(0, score)) : null;
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const offset = value != null ? c - (value / 100) * c : c;
  const stroke = TIER_STROKE[tier] || "#4ecdc4";

  return (
    <div className="ecc-score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="6"
        />
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
        <span className="ecc-score-ring-value">{value != null ? value : "—"}</span>
        {label ? <span className="ecc-score-ring-label">{label}</span> : null}
      </div>
    </div>
  );
}
