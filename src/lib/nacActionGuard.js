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

export const ACTION_SCOPE = {
  GLOBAL: "global",
  LOCAL: "local",
};

const AMBIGUOUS = /abort|timeout|timed out|network|failed to fetch|load failed|fetch is aborted/i;
const listeners = new Set();
let actions = [];
let snapshot = { actions };

function emit() {
  snapshot = { actions: actions.slice() };
  listeners.forEach((listener) => listener());
}

export function isAmbiguousActionError(error) {
  const message = String(error?.message || error || "");
  return AMBIGUOUS.test(message) || error?.name === "AbortError";
}

/**
 * Shared result for a mutation whose request may have committed before the connection failed.
 * Callers pass isConfirmed when they have re-read the server record.
 */
export function classifyGuardOutcome({ error = null, confirmed = undefined, uncertainMessage } = {}) {
  if (confirmed === true) {
    return { state: "success", retry: false, message: "" };
  }
  if (isAmbiguousActionError(error)) {
    if (confirmed == null) {
      return {
        state: "uncertain",
        retry: false,
        message: uncertainMessage || "We couldn’t confirm whether this action completed. Refresh status before trying again.",
      };
    }
    return {
      state: "rejected",
      retry: true,
      message: `${error?.message || "The request did not finish."} No change was confirmed.`,
    };
  }
  return {
    state: "rejected",
    retry: true,
    message: error?.message || "The action did not complete.",
  };
}

export function listGuardedActions() {
  return snapshot.actions;
}

export function subscribeGuardedActions(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getGuardedSnapshot() {
  return snapshot;
}

/**
 * Acquire synchronously. A global action blocks every other guarded action.
 * A local action blocks only the same id, so unrelated panels stay usable.
 */
export function beginGuardedAction({ id, scope = ACTION_SCOPE.LOCAL, label = "Working…" } = {}) {
  if (!id) return false;
  if (actions.some((action) => action.id === id)) return false;
  if (actions.some((action) => action.scope === ACTION_SCOPE.GLOBAL)) return false;
  if (scope === ACTION_SCOPE.GLOBAL && actions.length > 0) return false;
  actions = [...actions, { id, scope, label, startedAt: Date.now() }];
  emit();
  return true;
}

export function updateGuardedAction(id, patch = {}) {
  const current = actions.find((action) => action.id === id);
  if (!current) return false;
  actions = actions.map((action) => (action.id === id ? { ...action, ...patch, id } : action));
  emit();
  return true;
}

export function endGuardedAction(id) {
  if (!actions.some((action) => action.id === id)) return false;
  actions = actions.filter((action) => action.id !== id);
  emit();
  return true;
}

export function resetGuardedActions() {
  actions = [];
  emit();
}

export async function runGuardedAction({ id, scope = ACTION_SCOPE.LOCAL, label = "Working…", operation }) {
  if (!beginGuardedAction({ id, scope, label })) return { started: false, result: null };
  try {
    return { started: true, result: await operation() };
  } finally {
    endGuardedAction(id);
  }
}
