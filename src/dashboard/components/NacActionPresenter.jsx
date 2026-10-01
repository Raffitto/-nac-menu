import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  ACTION_SCOPE,
  actionOverlayCopy,
  getGuardedSnapshot,
  NAC_ACTION_OVERLAY_DELAY_MS,
  NAC_ACTION_STILL_WORKING_MS,
  subscribeGuardedActions,
} from "../../lib/nacActionGuard";
import "./nac-action-guard.css";

function NacMark() {
  return (
    <span className="nac-action-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/**
 * One presenter for consequential NAC actions.
 * The shield is immediate. The animation waits so a fast action does not flash.
 */
export default function NacActionPresenter() {
  const snapshot = useSyncExternalStore(subscribeGuardedActions, getGuardedSnapshot, getGuardedSnapshot);
  const globalAction = snapshot.actions.find((action) => action.scope === ACTION_SCOPE.GLOBAL) || null;
  const [copy, setCopy] = useState(null);

  useEffect(() => {
    if (!globalAction) {
      setCopy(null);
      return undefined;
    }
    let cancelled = false;
    const startedAt = globalAction.startedAt;
    const label = globalAction.label;
    const tick = () => {
      if (!cancelled) setCopy(actionOverlayCopy(Date.now() - startedAt, label));
    };
    tick();
    const delay = window.setTimeout(tick, Math.max(0, NAC_ACTION_OVERLAY_DELAY_MS - (Date.now() - startedAt)));
    const still = window.setTimeout(tick, Math.max(0, NAC_ACTION_STILL_WORKING_MS - (Date.now() - startedAt)));
    return () => {
      cancelled = true;
      window.clearTimeout(delay);
      window.clearTimeout(still);
    };
  }, [globalAction]);

  useEffect(() => {
    if (!globalAction) return undefined;
    const blockKeys = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target?.closest?.("[data-nac-action-overlay]")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", blockKeys, true);
    return () => window.removeEventListener("keydown", blockKeys, true);
  }, [globalAction]);

  if (!globalAction) return null;
  return (
    <div className="nac-action-shield" data-testid="nac-action-shield" data-nac-action-overlay="">
      {copy ? (
        <div className="nac-action-card" role="status" aria-live="polite" aria-busy="true" data-testid="nac-action-overlay">
          <NacMark />
          <p>{copy}</p>
        </div>
      ) : (
        <span className="nac-action-sr" role="status" aria-live="polite">Working…</span>
      )}
    </div>
  );
}
