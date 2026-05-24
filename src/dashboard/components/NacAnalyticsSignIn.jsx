import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Lock } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
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
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const configured = isSupabaseConfigured();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    setLoginError("");
    setLoginLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoginLoading(false);
    if (err) setLoginError(err.message);
  };

  if (checking) {
    return (
      <div className="nac-an relative min-h-70vh">
        <div className="nac-an__bg" />
        <div className="nac-an__inner p-6 flex justify-center">
          <div className="nac-an__card w-full max-w-md">
            <div className="nac-an__skeleton h-10 w-two-thirds mb-4" />
            <div className="nac-an__skeleton h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="nac-an relative min-h-70vh">
        <div className="nac-an__bg" />
        <div className="nac-an__inner p-6">
          <div className="nac-an__error flex items-center gap-3">
            <AlertCircle size={20} />
            <span>
              Supabase is not configured. Add{" "}
              <code className="text-gold">REACT_APP_SUPABASE_URL</code> and{" "}
              <code className="text-gold">REACT_APP_SUPABASE_ANON_KEY</code> to{" "}
              <code className="text-gold">.env.local</code>.
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nac-an relative min-h-70vh">
      <div className="nac-an__bg" />
      <div className="nac-an__inner flex justify-center py-10 px-4">
        <motion.div
          className="nac-an__card w-full max-w-md border"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
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
              disabled={loginLoading}
            >
              {loginLoading ? "Signing in…" : "Continue"}
            </button>
            <AuthForgotPassword email={email} onEmailChange={setEmail} />
          </form>
        </motion.div>
      </div>
    </div>
  );
}
