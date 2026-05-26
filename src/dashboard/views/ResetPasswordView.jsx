import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import {
  hydrateRecoverySession,
  updatePasswordFromRecovery,
  passwordsMatch,
} from "../../lib/passwordRecovery";
import "../styles/platform-os.css";

const inputStyle = {
  width: "100%",
  marginTop: 4,
  padding: "0.65rem 0.75rem",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(0,0,0,0.25)",
  color: "#f9f9f7",
};

export default function ResetPasswordView() {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setPhase("unconfigured");
      return undefined;
    }

    let cancelled = false;
    (async () => {
      const result = await hydrateRecoverySession(supabase);
      if (cancelled) return;
      if (result.ok) {
        setPhase("form");
        return;
      }
      setError(result.error || "This reset link is invalid or has expired.");
      setPhase("invalid");
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setPhase("form");
        setError("");
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!passwordsMatch(password, confirm)) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await updatePasswordFromRecovery(supabase, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPhase("success");
  };

  const goToAdminLogin = () => {
    window.location.href = "/";
  };

  return (
    <motion.div
      className="admin-shell"
      style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="nac-glass-panel"
        style={{ width: "100%", maxWidth: 440 }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <header style={{ marginBottom: "1.25rem" }}>
          <p className="nac-platform-kicker" style={{ margin: 0 }}>NAC Hospitality OS</p>
          <h1 style={{ margin: "0.35rem 0 0", fontSize: "1.35rem", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
            <KeyRound size={20} />
            Reset password
          </h1>
          <p className="nac-platform-sub" style={{ marginTop: "0.35rem" }}>
            Secure Supabase recovery — your role and branch access stay unchanged.
          </p>
        </header>

        {phase === "loading" && (
          <p style={{ color: "rgba(249,249,247,0.55)" }}>Verifying reset link…</p>
        )}

        {phase === "unconfigured" && (
          <p style={{ color: "rgba(249,249,247,0.55)", lineHeight: 1.6 }}>
            Supabase is not configured. Add <code>REACT_APP_SUPABASE_URL</code> and{" "}
            <code>REACT_APP_SUPABASE_ANON_KEY</code> to enable password recovery.
          </p>
        )}

        {phase === "invalid" && (
          <>
            <p style={{ color: "#f5a623", display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.5 }}>
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              {error}
            </p>
            <button type="button" className="nac-filter-action" onClick={goToAdminLogin} style={{ marginTop: "1rem" }}>
              Back to admin login
            </button>
          </>
        )}

        {phase === "form" && (
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>New password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>Confirm password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                style={inputStyle}
              />
            </label>
            {error && <p style={{ color: "#f5a623", fontSize: "0.85rem" }}>{error}</p>}
            <button type="submit" className="nac-filter-action" disabled={busy} style={{ marginTop: "0.35rem", width: "100%" }}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}

        {phase === "success" && (
          <>
            <p style={{ color: "#4ecdc4", display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.55 }}>
              <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              Password updated. Sign in with your new password on the admin login screen.
            </p>
            <button type="button" className="nac-filter-action" onClick={goToAdminLogin} style={{ marginTop: "1rem", width: "100%" }}>
              Continue to admin login
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
