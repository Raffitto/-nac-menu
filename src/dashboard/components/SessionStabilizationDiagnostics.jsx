import React from "react";
import { isNacDebugEnabled } from "../../lib/nacDebug";
import { useRbacOptional } from "../context/RbacContext";
import { RBAC_ROLES } from "../config/rbac";

function canViewSessionDiagnostics(rbac) {
  if (isNacDebugEnabled()) return true;
  const role = rbac?.profile?.role;
  return role === RBAC_ROLES.DEVELOPER || role === RBAC_ROLES.CEO;
}

/**
 * Hidden session integrity panel — dev flag or CEO/developer role.
 */
export default function SessionStabilizationDiagnostics({ diagnostics = null, className = "" }) {
  const rbac = useRbacOptional();
  if (!canViewSessionDiagnostics(rbac) || !diagnostics) return null;

  const d = diagnostics;
  return (
    <aside
      className={`nac-session-diagnostics ${className}`.trim()}
      aria-label="Session stabilization diagnostics"
    >
      <strong>Session diagnostics</strong>
      <dl>
        <div>
          <dt>Raw events</dt>
          <dd>{Number(d.total_raw_events || 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Valid sessions</dt>
          <dd>{Number(d.valid_sessions || 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Finalized sessions</dt>
          <dd>{Number(d.finalized_sessions || 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Orphaned removed</dt>
          <dd>{Number(d.orphaned_sessions_removed || 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Capped sessions</dt>
          <dd>{Number(d.capped_sessions || 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Passive-only %</dt>
          <dd>{d.passive_only_sessions_pct ?? 0}%</dd>
        </div>
        <div>
          <dt>Avg raw duration</dt>
          <dd>
            {d.avg_raw_duration_sec
              ? `${Math.round(d.avg_raw_duration_sec / 60)}m ${d.avg_raw_duration_sec % 60}s`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Avg corrected</dt>
          <dd>
            {d.avg_corrected_duration_sec
              ? `${Math.round(d.avg_corrected_duration_sec / 60)}m ${d.avg_corrected_duration_sec % 60}s`
              : "—"}
          </dd>
        </div>
      </dl>
    </aside>
  );
}
