import React from "react";
import { ShieldCheck, ShieldAlert, RefreshCw, Clock } from "lucide-react";
import { OPERATIONAL_TRUST } from "../../lib/analyticsUnifiedAdapter";

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
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/**
 * Executive operational trust — data source, freshness, rollup integrity.
 */
export default function OperationalTrustBadge({ trust = null, className = "" }) {
  if (!trust?.badge) return null;

  const Icon = BADGE_ICON[trust.badge] || ShieldCheck;
  const tone = BADGE_CLASS[trust.badge] || "";

  return (
    <aside
      className={`nac-operational-trust ${tone} ${className}`.trim()}
      role="status"
      aria-label={trust.label}
    >
      <div className="nac-operational-trust-head">
        <Icon size={16} aria-hidden />
        <strong>{trust.label?.toUpperCase() || "OPERATIONAL STATUS"}</strong>
      </div>
      <dl className="nac-operational-trust-meta">
        <div>
          <dt>Last sync</dt>
          <dd>{formatSyncTime(trust.lastSyncAt)}</dd>
        </div>
        {trust.eventCount > 0 ? (
          <div>
            <dt>Menu events</dt>
            <dd>{trust.eventCount.toLocaleString()}</dd>
          </div>
        ) : null}
        <div>
          <dt>Rollup integrity</dt>
          <dd>{trust.rollupIntegrity || "—"}</dd>
        </div>
        {trust.dataSource ? (
          <div>
            <dt>Source</dt>
            <dd>{trust.dataSource}</dd>
          </div>
        ) : null}
      </dl>
    </aside>
  );
}
