import React from "react";
import { motion } from "framer-motion";
import { Sparkles, AlertTriangle, Info, TrendingUp } from "lucide-react";

const TYPE_CONFIG = {
  positive: { icon: Sparkles, className: "nac-bi-insight-positive" },
  warning: { icon: AlertTriangle, className: "nac-bi-insight-warning" },
  neutral: { icon: Info, className: "nac-bi-insight-neutral" },
  opportunity: { icon: TrendingUp, className: "nac-bi-insight-opportunity" },
};

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

export default function InsightEngine({ insights }) {
  const items = insights || [];

  if (items.length === 0) {
    return (
      <motion.div
        className="nac-bi-insights nac-bi-insights--empty"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <span className="nac-bi-insights-empty-text">No insights available yet</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="nac-bi-insights"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {items.map((insight, i) => {
        const config = TYPE_CONFIG[insight?.type] || TYPE_CONFIG.neutral;
        const Icon = config.icon;

        return (
          <motion.div
            key={`${insight?.type}-${i}`}
            className={`nac-bi-insight-card ${config.className}`}
            variants={cardVariants}
          >
            <Icon size={16} className="nac-bi-insight-icon" />
            <span className="nac-bi-insight-text">{insight?.text || ""}</span>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
