import React, { useMemo } from "react";
import { motion } from "framer-motion";

const STAGES = [
  { key: "qr_scans", label: "QR Scan" },
  { key: "category_opens", label: "Category Open" },
  { key: "item_opens", label: "Item View" },
  { key: "addon_clicks", label: "Add-on Click" },
  { key: "time_spent", label: "Time Spent" },
  { key: "exits", label: "Exit" },
];

const BAR_COLORS = [
  "#4a6d76",
  "#5a7f85",
  "#7a9a7e",
  "#a3ad7a",
  "#c4b07f",
  "#d7bc8a",
];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const stageVariants = {
  hidden: { opacity: 0, x: -30 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

export default function FunnelChart({ funnel }) {
  const data = useMemo(() => funnel || {}, [funnel]);

  const stages = useMemo(() => {
    const values = STAGES.map((s) => ({
      ...s,
      value: Number(data[s.key]) || 0,
    }));
    const maxVal = Math.max(...values.map((v) => v.value), 1);

    return values.map((stage, i) => {
      const prev = i > 0 ? values[i - 1].value : null;
      const conversionPct = prev && prev > 0 ? ((stage.value / prev) * 100).toFixed(1) : null;
      const dropoffPct = conversionPct !== null ? (100 - parseFloat(conversionPct)).toFixed(1) : null;
      const widthPct = (stage.value / maxVal) * 100;

      return { ...stage, widthPct, conversionPct, dropoffPct };
    });
  }, [data]);

  const allZero = stages.every((s) => s.value === 0);

  return (
    <motion.div
      className="nac-bi-funnel"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {stages.map((stage, i) => (
        <motion.div key={stage.key} className="nac-bi-funnel-stage" variants={stageVariants}>
          <div className="nac-bi-funnel-label">
            <span className="nac-bi-funnel-label-name">{stage.label}</span>
            <span className="nac-bi-funnel-label-value">
              {stage.value.toLocaleString()}
            </span>
          </div>
          <div className="nac-bi-funnel-bar-track">
            <motion.div
              className="nac-bi-funnel-bar"
              style={{ background: BAR_COLORS[i] }}
              initial={{ width: 0 }}
              animate={{ width: `${stage.widthPct}%` }}
              transition={{ duration: 0.6, delay: i * 0.1, ease: "easeOut" }}
            />
          </div>
          <div className="nac-bi-funnel-pct">
            {stage.conversionPct !== null ? (
              <>
                <span className="nac-bi-funnel-pct-conv">
                  {allZero ? "—" : `${stage.conversionPct}% from previous`}
                </span>
                <span className="nac-bi-funnel-pct-drop">
                  {allZero ? "" : `↓ ${stage.dropoffPct}% dropoff`}
                </span>
              </>
            ) : (
              <span className="nac-bi-funnel-pct-conv">{allZero ? "—" : "Entry point"}</span>
            )}
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
