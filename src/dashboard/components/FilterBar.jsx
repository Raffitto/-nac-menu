import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, RefreshCw } from "lucide-react";

const BRANCHES = ["Khobar", "Riyadh", "Jeddah", "All"];
const TIME_RANGES = [
  { label: "Today", value: 24, title: "NAC business day · 3:00 AM – 2:59 AM (Riyadh)" },
  { label: "7D", value: 168, title: "Last 7 business-day windows" },
  { label: "Month-to-date", value: 999, title: "Calendar month to date from the 1st (Asia/Riyadh)" },
  { label: "All", value: 0, title: "All time" },
];

export default function FilterBar({
  branch,
  setBranch,
  timeRange,
  setTimeRange,
  liveMode,
  setLiveMode,
  onRefresh,
  onExport,
  loading,
}) {
  return (
    <motion.div
      className="nac-bi-filter-bar"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <div className="nac-bi-filter-group">
        {BRANCHES.map((b) => (
          <button
            key={b}
            className={`nac-bi-filter-pill ${branch === b ? "nac-bi-filter-active nac-bi-filter-active--branch" : ""}`}
            onClick={() => setBranch?.(b)}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="nac-bi-filter-group">
        {TIME_RANGES.map((t) => (
          <button
            key={t.value}
            className={`nac-bi-filter-pill ${timeRange === t.value ? "nac-bi-filter-active nac-bi-filter-active--time" : ""}`}
            onClick={() => setTimeRange?.(t.value)}
            title={t.title}
          >
            {t.label}
          </button>
        ))}
      </div>

      <button
        className={`nac-bi-filter-pill nac-bi-filter-pill--live ${liveMode ? "nac-bi-filter-active--live" : ""}`}
        onClick={() => setLiveMode?.(!liveMode)}
      >
        <AnimatePresence>
          {liveMode && (
            <motion.span
              className="nac-bi-live-dot"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
            />
          )}
        </AnimatePresence>
        Live
      </button>

      <button
        className="nac-bi-filter-pill nac-bi-filter-pill--action"
        onClick={onExport}
        title="Export CSV"
      >
        <Download size={15} />
      </button>

      <motion.button
        className="nac-bi-filter-pill nac-bi-filter-pill--action"
        onClick={onRefresh}
        title="Refresh"
        animate={loading ? { rotate: 360 } : { rotate: 0 }}
        transition={loading ? { duration: 1, repeat: Infinity, ease: "linear" } : { duration: 0.3 }}
      >
        <RefreshCw size={15} />
      </motion.button>
    </motion.div>
  );
}
