import React from "react";
import { motion } from "framer-motion";
import { Info } from "lucide-react";
import InternalOpsStatusPanel from "./InternalOpsStatusPanel";

/**
 * Executive-safe platform status (user message) + collapsible ops detail.
 */
export default function PlatformStatusBanner({ platformStatus = null, className = "" }) {
  if (!platformStatus) return null;

  const { showUserBanner, userMessage, showOpsPanel, opsNotes, label, confidence } =
    platformStatus;

  if (!showUserBanner && !showOpsPanel) return null;

  return (
    <div className={`nac-platform-status ${className}`.trim()}>
      {showUserBanner && userMessage ? (
        <motion.div
          className="nac-platform-status-banner"
          role="status"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Info size={16} aria-hidden />
          <div className="nac-platform-status-copy">
            {label ? <strong>{label}</strong> : null}
            <p>{userMessage}</p>
            {confidence === "low" ? (
              <span className="nac-platform-status-meta">Early period — interpret with care</span>
            ) : null}
          </div>
        </motion.div>
      ) : null}
      {showOpsPanel ? <InternalOpsStatusPanel notes={opsNotes} /> : null}
    </div>
  );
}
