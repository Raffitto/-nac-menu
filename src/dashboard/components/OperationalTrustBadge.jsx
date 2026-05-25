import React from "react";
import { ShieldCheck, ShieldAlert, RefreshCw, Clock } from "lucide-react";
import { OPERATIONAL_TRUST } from "../../lib/unifiedOperationalTruth";

const BADGE_CLASS = {
  [OPERATIONAL_TRUST.LIVE_VERIFIED]: "nac-trust--verified",
  [OPERATIONAL_TRUST.PARTIAL_LIVE]: "nac-trust--partial",
  [OPERATIONAL_TRUST.ROLLUP_RECOVERED]: "nac-trust--recovered",
  [OPERATIONAL_TRUST.STALE_DETECTED]: "nac-trust--stale",
};

const BADGE_ICON = {
  [OPERATIONAL_TRUST.LIVE_VERIFIED]: ShieldCheck,
  [OPERATIONAL_TRUST.PARTIAL_LIVE]: ShieldAlert,
  [OPERATIONAL_TRUST.ROLLUP_RECOVERED]: RefreshCw,
  [OPERATIONAL_TRUST.STALE_DETECTED]: Clock,
};

function formatSyncTime(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

/**
 * Compact operational trust — executive-facing status only.
 */
export default function OperationalTrustBadge({ trust = null, className = "", compact = true }) {
  if (!trust?.badge) return null;

  const Icon = BADGE_ICON[trust.badge] || ShieldCheck;
  const tone = BADGE_CLASS[trust.badge] || "";
  const label = trust.label || "STATUS";
  const sync = formatSyncTime(trust.lastSyncAt);

  if (compact) {
    return (
      <span
        className={`nac-operational-trust nac-operational-trust--compact ${tone} ${className}`.trim()}
        role="status"
        title={sync ? `Last sync ${sync}` : undefined}
        aria-label={label}
      >
        <Icon size={13} aria-hidden />
        <strong>{label}</strong>
        {sync ? <span className="nac-trust-sync">{sync}</span> : null}
      </span>
    );
  }

  return (
    <aside
      className={`nac-operational-trust ${tone} ${className}`.trim()}
      role="status"
      aria-label={label}
    >
      <div className="nac-operational-trust-head">
        <Icon size={14} aria-hidden />
        <strong>{label}</strong>
      </div>
      {sync ? (
        <p className="nac-trust-sync-line">Synced {sync}</p>
      ) : null}
    </aside>
  );
}
