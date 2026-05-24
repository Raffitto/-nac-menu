import React from "react";
import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";

export default function AccessDeniedPanel({ title = "Access restricted", message }) {
  return (
    <motion.div
      className="big-glass-card"
      style={{ marginTop: 28, padding: "2rem", textAlign: "center" }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <ShieldAlert size={32} style={{ marginBottom: 12, opacity: 0.7 }} />
      <h3 style={{ margin: "0 0 0.5rem" }}>{title}</h3>
      <p style={{ margin: 0, opacity: 0.65, maxWidth: 480, marginInline: "auto" }}>
        {message || "Your NAC OS role does not include access to this area."}
      </p>
    </motion.div>
  );
}
