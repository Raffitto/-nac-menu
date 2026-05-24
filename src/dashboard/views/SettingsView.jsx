import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Settings, LogOut } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import AuthForgotPassword from "../components/AuthForgotPassword";
import "../styles/platform-os.css";

export default function SettingsView() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
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

  const signOut = async () => {
    await supabase?.auth.signOut();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="nac-platform-header">
        <p className="nac-platform-kicker">Platform</p>
        <h1>Settings</h1>
        <p className="nac-platform-sub">Authentication and workspace preferences</p>
      </header>

      <div className="nac-glass-panel" style={{ maxWidth: 420 }}>
        <h3 style={{ margin: "0 0 1rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
          <Settings size={18} />
          Supabase access
        </h3>

        {!isSupabaseConfigured() && (
          <p style={{ color: "rgba(249,249,247,0.55)", lineHeight: 1.6 }}>
            Add <code>REACT_APP_SUPABASE_URL</code> and <code>REACT_APP_SUPABASE_ANON_KEY</code> to enable analytics.
          </p>
        )}

        {isSupabaseConfigured() && session && (
          <>
            <p style={{ color: "rgba(249,249,247,0.65)", marginBottom: "1rem" }}>
              Signed in as <strong>{session.user?.email}</strong>
            </p>
            <button type="button" className="nac-filter-action" onClick={signOut}>
              <LogOut size={14} />
              Sign out
            </button>
          </>
        )}

        {isSupabaseConfigured() && !session && (
          <form onSubmit={signIn}>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ width: "100%", marginTop: 4, padding: "0.6rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.2)", color: "#f9f9f7" }}
              />
            </label>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: "100%", marginTop: 4, padding: "0.6rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.2)", color: "#f9f9f7" }}
              />
            </label>
            {error && <p style={{ color: "#f5a623", fontSize: "0.85rem" }}>{error}</p>}
            <button type="submit" className="nac-filter-action" disabled={busy} style={{ marginTop: "0.5rem" }}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <AuthForgotPassword email={email} onEmailChange={setEmail} />
          </form>
        )}
      </div>
    </motion.div>
  );
}
