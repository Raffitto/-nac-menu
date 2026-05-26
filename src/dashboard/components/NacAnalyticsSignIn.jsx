import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Lock, WifiOff } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import {
  formatSupabaseSetupMessage,
  isBrowserOffline,
  mapAuthError,
} from "../../lib/platformAuth";
import AuthForgotPassword from "./AuthForgotPassword";
import "../styles/analytics-dashboard.css";

/**
 * Shared NAC Analytics / NAC OS sign-in screen (nac-an styling).
 */
export default function NacAnalyticsSignIn({
  checking = false,
  kicker = "NAC Analytics",
  title = "Sign in",
  subtitle = "Authorized team members only",
  sessionIssue = null,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [offline, setOffline] = useState(isBrowserOffline());

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const configured = isSupabaseConfigured();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!supabase || offline) return;
    setLoginError("");
    setLoginLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoginLoading(false);
    if (err) setLoginError(mapAuthError(err.message));
  };

  if (checking) {
    return (
      <div className="nac-an relative min-h-100vh">
        <div className="nac-an__bg" />
        <div className="nac-an__inner p-6 flex justify-center items-center min-h-100vh">
          <motion.div
            className="nac-an__card w-full max-w-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
          >
            <div className="nac-an__skeleton h-10 w-two-thirds mb-4" />
            <div className="nac-an__skeleton h-12 w-full mb-3" />
            <div className="nac-an__skeleton h-12 w-full mb-3" />
            <div className="nac-an__skeleton h-11 w-full" />
          </motion.div>
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="nac-an relative min-h-100vh">
        <div className="nac-an__bg" />
        <div className="nac-an__inner p-6 flex justify-center items-center min-h-100vh">
          <div className="nac-an__card w-full max-w-md">
            <div className="nac-an__error flex items-start gap-3">
              <AlertCircle size={20} className="shrink-0 mt-05" />
              <span>{formatSupabaseSetupMessage()}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sessionMessage =
    sessionIssue === "session_timeout"
      ? "Session check timed out. Sign in to continue."
      : sessionIssue && sessionIssue !== "not_configured"
        ? mapAuthError(sessionIssue)
        : null;

  return (
    <div className="nac-an relative min-h-100vh">
      <div className="nac-an__bg" />
      <div className="nac-an__inner flex justify-center items-center py-10 px-4 min-h-100vh">
        <motion.div
          className="nac-an__card w-full max-w-md border"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center gap-3 mb-6">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl border"
              style={{
                borderColor: "rgba(143,122,87,0.35)",
                background: "rgba(48,72,78,0.35)",
              }}
            >
              <Lock size={22} className="text-gold" />
            </div>
            <div>
              <p className="text-xs text-gold mb-1 tracking-wide">{kicker}</p>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-sm text-white/50 mt-1">{subtitle}</p>
            </div>
          </div>

          {offline && (
            <div className="nac-an__error text-sm mb-4 flex items-center gap-2">
              <WifiOff size={16} />
              You appear to be offline. Reconnect to sign in.
            </div>
          )}

          {sessionMessage && (
            <div className="nac-an__error text-sm mb-4">{sessionMessage}</div>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-white/50 mb-2 block">Email</label>
              <input
                className="nac-an__input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@nac.com"
                required
                disabled={offline}
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-2 block">Password</label>
              <input
                className="nac-an__input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={offline}
              />
            </div>

            <AnimatePresence>
              {loginError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="nac-an__error text-sm"
                >
                  {loginError}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              className="nac-an__btn nac-an__btn--primary w-full py-3"
              disabled={loginLoading || offline}
            >
              {loginLoading ? "Signing in…" : "Continue"}
            </button>
          </form>
          <AuthForgotPassword email={email} onEmailChange={setEmail} />
        </motion.div>
      </div>
    </div>
  );
}
