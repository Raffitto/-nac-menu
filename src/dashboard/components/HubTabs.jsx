import React from "react";
import { motion } from "framer-motion";

/** Premium sub-navigation tabs for hub sections. */
export default function HubTabs({ tabs, active, onChange, className = "" }) {
  return (
    <nav className={`nac-hub-tabs ${className}`.trim()} role="tablist" aria-label="Section tabs">
      {tabs.map((tab) => (
        <motion.button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`nac-hub-tab ${active === tab.id ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
          whileTap={{ scale: 0.98 }}
        >
          {tab.label}
        </motion.button>
      ))}
    </nav>
  );
}
