import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Server } from "lucide-react";

/**
 * Collapsible internal diagnostics — rollup notes, fallback paths (admin-only surfaces).
 */
export default function InternalOpsStatusPanel({ notes = [], defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const list = (notes || []).filter(Boolean);
  if (!list.length) return null;

  return (
    <motion.div
      className="nac-ops-status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <button
        type="button"
        className="nac-ops-status-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Server size={14} />
        <span>System status &amp; data sources</span>
        <ChevronDown size={14} className={open ? "nac-ops-status-chevron--open" : ""} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            className="nac-ops-status-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <ul>
              {list.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
