/** True when internal pipeline / tracking diagnostics are enabled. */
export function isNacDebugEnabled() {
  if (typeof window === "undefined") return false;
  return window.NAC_DEBUG === true;
}
