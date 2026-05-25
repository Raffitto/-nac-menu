import React from "react";
import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { signOutPlatform } from "../../lib/platformAuth";
import "../styles/analytics-dashboard.css";

/**
 * Full-screen gate for authenticated users without RBAC provisioning.
 */
export default function NacPlatformAccessGate({ email, onSignOut }) {
  const handleSignOut = async () => {
    await signOutPlatform();
    onSignOut?.();
  };

  return (
    <div className="nac-an relative min-h-100vh">
      <div className="nac-an__bg" />
      <div className="nac-an__inner flex justify-center py-16 px-4">
        <motion.div
          className="nac-an__card w-full max-w-md text-center"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex justify-center mb-5">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl border"
              style={{
                borderColor: "rgba(143,122,87,0.35)",
                background: "rgba(48,72,78,0.35)",
              }}
            >
              <ShieldAlert size={26} className="text-gold" />
            </div>
          </div>
          <p className="text-xs text-gold mb-2 tracking-wide">NAC Hospitality OS</p>
          <h2 className="text-lg font-semibold mb-2">Access not provisioned</h2>
          <p className="text-sm text-white/55 leading-relaxed mb-6">
            {email ? (
              <>
                <span className="text-white/70">{email}</span> is signed in but is not assigned a
                NAC OS role yet.
              </>
            ) : (
              "Your account is signed in but is not assigned a NAC OS role yet."
            )}{" "}
            Contact your administrator to enable access.
          </p>
          <button type="button" className="nac-an__btn nac-an__btn--primary w-full py-3" onClick={handleSignOut}>
            Sign out
          </button>
        </motion.div>
      </div>
    </div>
  );
}
