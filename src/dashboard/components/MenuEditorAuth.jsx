import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LogIn } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import "../styles/platform-os.css";

/**
 * Supabase Auth gate for Menu Manager writes.
 * The guest menu uses the anon key; CRUD requires an authenticated session.
 */
export default function MenuEditorAuth({ children }) {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return undefined;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  };

  if (checking) {
    return (
      <div className="nac-bi-loading" style={{ minHeight: 240, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span>Checking sign-in…</span>
      </div>
    );
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="nac-glass-panel" style={{ maxWidth: 480, margin: "2rem auto" }}>
        <p style={{ color: "rgba(249,249,247,0.65)", lineHeight: 1.6 }}>
          Add <code>REACT_APP_SUPABASE_URL</code> and <code>REACT_APP_SUPABASE_ANON_KEY</code> to use the Menu Manager.
        </p>
      </div>
    );
  }

  if (session) {
    return children;
  }

  return (
    <motion.div
      className="nac-glass-panel"
      style={{ maxWidth: 440, margin: "2rem auto" }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h3 style={{ margin: "0 0 0.5rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
        <LogIn size={18} />
        Sign in to edit the menu
      </h3>
      <p style={{ color: "rgba(249,249,247,0.55)", fontSize: "0.9rem", lineHeight: 1.55, marginBottom: "1.25rem" }}>
        Menu changes require a Supabase staff account. The app admin password only opens this dashboard;
        create a user under Authentication → Users, then sign in here.
      </p>
      <form onSubmit={signIn}>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          <span style={{ fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            style={{
              width: "100%",
              marginTop: 4,
              padding: "0.6rem",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.2)",
              color: "#f9f9f7",
            }}
          />
        </label>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          <span style={{ fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{
              width: "100%",
              marginTop: 4,
              padding: "0.6rem",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.2)",
              color: "#f9f9f7",
            }}
          />
        </label>
        {error && <p style={{ color: "#f5a623", fontSize: "0.85rem" }}>{error}</p>}
        <button type="submit" className="nac-filter-action" disabled={busy} style={{ marginTop: "0.5rem" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </motion.div>
  );
}
