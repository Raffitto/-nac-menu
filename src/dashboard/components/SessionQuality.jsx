import React, { useMemo } from "react";
import { motion } from "framer-motion";

const TIERS = [
  { key: "bounce", label: "Bounce", color: "#6b4040" },
  { key: "casual", label: "Casual", color: "#8f7a57" },
  { key: "engaged", label: "Engaged", color: "#4a6d76" },
  { key: "deep", label: "Deep", color: "#d7bc8a" },
  { key: "power", label: "Power", color: "#76d69f" },
];

export default function SessionQuality({ quality, totalSessions }) {
  const data = useMemo(() => quality || {}, [quality]);
  const total = totalSessions || Object.values(data).reduce((a, b) => a + (Number(b) || 0), 0) || 0;

  const segments = useMemo(
    () =>
      TIERS.map((tier) => {
        const count = Number(data[tier.key]) || 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        return { ...tier, count, pct };
      }),
    [data, total]
  );

  return (
    <motion.div
      className="nac-bi-quality"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="nac-bi-quality-bar">
        {segments.map((seg) =>
          seg.pct > 0 ? (
            <motion.div
              key={seg.key}
              className="nac-bi-quality-segment"
              style={{ background: seg.color }}
              initial={{ width: 0 }}
              animate={{ width: `${seg.pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              title={`${seg.label}: ${seg.count} (${seg.pct.toFixed(1)}%)`}
            />
          ) : null
        )}
        {total === 0 && (
          <div
            className="nac-bi-quality-segment nac-bi-quality-segment--empty"
            style={{ width: "100%", background: "rgba(255,255,255,0.06)" }}
          />
        )}
      </div>

      <div className="nac-bi-quality-legend">
        {segments.map((seg) => (
          <div key={seg.key} className="nac-bi-quality-row">
            <span
              className="nac-bi-quality-swatch"
              style={{ background: seg.color }}
            />
            <span className="nac-bi-quality-tier-name">{seg.label}</span>
            <span className="nac-bi-quality-tier-count">{seg.count.toLocaleString()}</span>
            <span className="nac-bi-quality-tier-pct">
              {total > 0 ? `${seg.pct.toFixed(1)}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
