/**
 * Shared lock for consequential NAC actions.
 * Acquire before any await so a second click cannot submit.
 * Overlay copy stays hidden until NAC_ACTION_OVERLAY_DELAY_MS; the lock does not wait.
 * Screens should use this primitive instead of a private spinner boolean.
 * Ambiguous mutations still have to reconcile with the server before release.
 */
/** Immediate interaction lock. The visual overlay waits so fast work does not flash. */
export const NAC_ACTION_OVERLAY_DELAY_MS = 300;
export const NAC_ACTION_STILL_WORKING_MS = 8000;

export function createActionLock() {
  let held = false;
  return {
    tryAcquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
    isHeld() {
      return held;
    },
  };
}

export function actionOverlayCopy(elapsedMs, label = "Working…") {
  if (elapsedMs < NAC_ACTION_OVERLAY_DELAY_MS) return null;
  if (elapsedMs >= NAC_ACTION_STILL_WORKING_MS) return "Still working — please keep this page open.";
  return label;
}
