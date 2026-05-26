import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, CheckCircle2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { requestPasswordResetEmail } from "../../lib/passwordRecovery";

const inputStyle = {
  width: "100%",
  marginTop: 4,
  padding: "0.6rem",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(0,0,0,0.2)",
  color: "#f9f9f7",
};

/**
 * Inline forgot-password flow — Supabase email recovery only.
 */
export default function AuthForgotPassword({
  email = "",
  onEmailChange,
  className = "",
  linkClassName = "nac-auth-forgot-link",
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [localEmail, setLocalEmail] = useState(email);

  const value = onEmailChange ? email : localEmail;
  const setValue = onEmailChange || setLocalEmail;

  const sendReset = async (e) => {
    e.preventDefault();
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }
    setBusy(true);
    setError("");
    setSent(false);
    const result = await requestPasswordResetEmail(supabase, trimmed);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Could not send reset email.");
      return;
    }
    setSent(true);
    if (onEmailChange) onEmailChange(trimmed);
    else setLocalEmail(trimmed);
  };

  if (!open) {
    return (
      <button
        type="button"
        className={linkClassName}
        onClick={() => setOpen(true)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          color: "rgba(215,188,138,0.9)",
          fontSize: "0.82rem",
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 3,
        }}
      >
        Forgot password?
      </button>
    );
  }

  return (
    <motion.div
      className={`nac-auth-forgot ${className}`.trim()}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}
    >
      <p style={{ margin: "0 0 0.65rem", fontSize: "0.82rem", color: "rgba(249,249,247,0.55)", display: "flex", alignItems: "center", gap: 6 }}>
        <Mail size={14} />
        Reset via email
      </p>

      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div
            key="sent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ fontSize: "0.85rem", color: "#4ecdc4", lineHeight: 1.5 }}
          >
            <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            If an account exists for <strong>{String(value || "").trim()}</strong>, a reset link is on its way. Check spam if needed.
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={sendReset}>
            <label style={{ display: "block", marginBottom: "0.65rem" }}>
              <span style={{ fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>Account email</span>
              <input
                type="email"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                autoComplete="username"
                style={inputStyle}
              />
            </label>
            {error && <p style={{ color: "#f5a623", fontSize: "0.85rem", margin: "0 0 0.5rem" }}>{error}</p>}
            <motion.div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="submit" className="nac-filter-action" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
              <button
                type="button"
                className="nac-filter-action"
                onClick={() => {
                  setOpen(false);
                  setError("");
                  setSent(false);
                }}
                style={{ opacity: 0.85 }}
              >
                Cancel
              </button>
            </motion.div>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
