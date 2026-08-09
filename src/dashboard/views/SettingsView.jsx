import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Settings,
  LogOut,
  Shield,
  Building2,
  Layout,
  User,
  KeyRound,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { signOutPlatform, mapAuthError } from "../../lib/platformAuth";
import { clearSessionIntelligenceCaches } from "../utils/intelligenceCache";
import {
  SIDEBAR_KEYS,
  writeSidebarCollapsed,
  notifyLayoutResize,
  readSidebarCollapsed,
} from "../../lib/sidebarPrefs";
import { RBAC_ROLES } from "../config/rbac";
import { branchExportName } from "../config/branchDisplayConfig";
import { useRbacOptional } from "../context/RbacContext";
import AuthForgotPassword from "../components/AuthForgotPassword";
import "../styles/platform-os.css";
import "../styles/settings-view.css";

const ROLE_LABELS = {
  [RBAC_ROLES.DEVELOPER]: "Super Admin",
  [RBAC_ROLES.CEO]: "Executive",
  [RBAC_ROLES.BRANCH_GM]: "Branch Manager",
  [RBAC_ROLES.RESTRICTED]: "Restricted",
};

function branchAccessLabel(branchId) {
  return branchExportName(branchId) || branchId || "Not configured";
}

function roleLabel(role) {
  return ROLE_LABELS[role] || "Not configured";
}

function permissionSummary(profile, rbac) {
  if (!profile?.authenticated) return [];
  const items = [];
  if (rbac?.canAccessNav?.("overview")) items.push("Overview");
  if (rbac?.canAccessNav?.("intelligence")) items.push("Intelligence");
  if (rbac?.canAccessNav?.("reviews")) items.push("Reviews");
  if (rbac?.canAccessNav?.("menu")) items.push("Menu");
  if (rbac?.canAccessNav?.("branches")) items.push("Branches");
  if (rbac?.canAccessNav?.("settings")) items.push("Settings");
  if (rbac?.hasPermission?.("manage:menu")) items.push("Manage menu");
  if (rbac?.hasPermission?.("manage:system")) items.push("System");
  return items;
}

/**
 * Settings — account, access, workspace preferences, security.
 * Uses real session + RBAC + sidebar prefs. No invented toggles.
 */
export default function SettingsView({ session: sessionProp = undefined }) {
  const rbac = useRbacOptional();
  const session = sessionProp !== undefined ? sessionProp : rbac?.session;
  const profile = rbac?.profile;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prefsNote, setPrefsNote] = useState("");
  const [prefsTick, setPrefsTick] = useState(0);

  const signedIn = Boolean(session?.user);
  const displayName = profile?.name || session?.user?.email?.split("@")[0] || "Not configured";
  const displayEmail = profile?.email || session?.user?.email || "Not configured";
  const role = roleLabel(profile?.role);

  const branchRows = useMemo(() => {
    void prefsTick;
    if (!profile?.authenticated) return [];
    if (profile.allBranches) {
      return (rbac?.branchFilterOptions || [])
        .filter((o) => o.value && o.value !== "all")
        .map((o) => ({
          id: o.value,
          label: branchAccessLabel(o.value),
          access: role,
        }));
    }
    if (profile.branchScope) {
      return [
        {
          id: profile.branchScope,
          label: branchAccessLabel(profile.branchScope),
          access: role,
        },
      ];
    }
    return [];
  }, [profile, rbac?.branchFilterOptions, role, prefsTick]);

  const primaryBranch = profile?.allBranches
    ? "Network-wide"
    : profile?.branchScope
      ? branchAccessLabel(profile.branchScope)
      : "Not configured";

  const perms = useMemo(() => permissionSummary(profile, rbac), [profile, rbac]);

  const globalCollapsed = readSidebarCollapsed(SIDEBAR_KEYS.global, false);
  const menuCollapsed = readSidebarCollapsed(SIDEBAR_KEYS.menu, false);

  const signIn = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(mapAuthError(err.message));
  };

  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      clearSessionIntelligenceCaches();
      await signOutPlatform();
    } catch (err) {
      setError(mapAuthError(err?.message));
    } finally {
      setBusy(false);
    }
  };

  const resetSidebarLayout = () => {
    writeSidebarCollapsed(SIDEBAR_KEYS.global, false);
    writeSidebarCollapsed(SIDEBAR_KEYS.menu, false);
    notifyLayoutResize();
    setPrefsTick((n) => n + 1);
    setPrefsNote("Sidebar layout reset to expanded.");
  };

  return (
    <motion.div
      className="nac-settings"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      data-testid="settings-view"
    >
      <header className="nac-platform-header">
        <p className="nac-platform-kicker">Platform</p>
        <h1>Settings</h1>
        <p className="nac-platform-sub">
          Manage your account, access and workspace preferences
        </p>
      </header>

      {!isSupabaseConfigured() && (
        <section className="nac-settings-card" data-testid="settings-config-missing">
          <h3>
            <Settings size={18} />
            Platform access
          </h3>
          <p className="nac-settings-muted">
            Platform sign-in is unavailable. Contact your NAC administrator.
          </p>
        </section>
      )}

      {isSupabaseConfigured() && signedIn && (
        <>
          <section className="nac-settings-card" data-testid="settings-account">
            <h3>
              <User size={18} />
              Account
            </h3>
            <dl className="nac-settings-dl">
              <div>
                <dt>Name</dt>
                <dd>{displayName}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{displayEmail}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{role}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>Signed in</dd>
              </div>
            </dl>
            {profile?.unmapped ? (
              <p className="nac-settings-warn">
                This account is signed in but not mapped to a NAC OS staff role.
              </p>
            ) : null}
          </section>

          <section className="nac-settings-card" data-testid="settings-access">
            <h3>
              <Building2 size={18} />
              Access
            </h3>
            <dl className="nac-settings-dl">
              <div>
                <dt>Primary scope</dt>
                <dd>{primaryBranch}</dd>
              </div>
              <div>
                <dt>Branch access</dt>
                <dd>
                  {branchRows.length === 0 ? (
                    <span className="nac-settings-muted">Not configured</span>
                  ) : (
                    <ul className="nac-settings-list">
                      {branchRows.map((b) => (
                        <li key={b.id}>
                          {b.label}
                          <span className="nac-settings-chip">{b.access}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
              <div>
                <dt>Permissions</dt>
                <dd>
                  {perms.length === 0 ? (
                    <span className="nac-settings-muted">Not configured</span>
                  ) : (
                    <ul className="nac-settings-list nac-settings-list--inline">
                      {perms.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="nac-settings-card" data-testid="settings-workspace">
            <h3>
              <Layout size={18} />
              Workspace
            </h3>
            <p className="nac-settings-muted">
              Personal navigation layout preferences stored on this device.
            </p>
            <dl className="nac-settings-dl">
              <div>
                <dt>App navigation sidebar</dt>
                <dd>{globalCollapsed ? "Collapsed" : "Expanded"}</dd>
              </div>
              <div>
                <dt>Menu Manager sidebar</dt>
                <dd>{menuCollapsed ? "Collapsed" : "Expanded"}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="nac-filter-action"
              onClick={resetSidebarLayout}
              data-testid="settings-reset-sidebars"
            >
              Reset sidebar layout
            </button>
            {prefsNote ? <p className="nac-settings-ok">{prefsNote}</p> : null}
          </section>

          {(profile?.role === RBAC_ROLES.DEVELOPER || profile?.devOverride) && (
            <section className="nac-settings-card" data-testid="settings-system">
              <h3>
                <Shield size={18} />
                System
              </h3>
              <p className="nac-settings-muted">
                Technical details for platform operators. Not shown to branch managers.
              </p>
              <dl className="nac-settings-dl">
                <div>
                  <dt>Directory id</dt>
                  <dd>{profile?.userId || "Not configured"}</dd>
                </div>
                <div>
                  <dt>Network access</dt>
                  <dd>{profile?.allBranches ? "All branches" : "Scoped"}</dd>
                </div>
              </dl>
            </section>
          )}

          <section className="nac-settings-card" data-testid="settings-security">
            <h3>
              <KeyRound size={18} />
              Security
            </h3>
            <p className="nac-settings-muted">
              Sign out clears this session and local intelligence cache for the next account.
            </p>
            {error ? <p className="nac-settings-warn">{error}</p> : null}
            <button
              type="button"
              className="nac-filter-action"
              onClick={signOut}
              disabled={busy}
              data-testid="settings-sign-out"
            >
              <LogOut size={14} />
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </section>
        </>
      )}

      {isSupabaseConfigured() && !signedIn && (
        <section className="nac-settings-card" data-testid="settings-sign-in">
          <h3>
            <Settings size={18} />
            Sign in
          </h3>
          <p className="nac-settings-muted">
            Sign in with your NAC staff account to access the platform.
          </p>
          <form onSubmit={signIn}>
            <label className="nac-settings-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </label>
            <label className="nac-settings-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
            {error ? <p className="nac-settings-warn">{error}</p> : null}
            <button type="submit" className="nac-filter-action" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <AuthForgotPassword email={email} onEmailChange={setEmail} />
        </section>
      )}
    </motion.div>
  );
}
