/** Client deadline so a hung auth refresh or REST call cannot pin a loading flag. */
export const NAC_FETCH_DEADLINE_MS = 12000;

export function fetchWithDeadline(input, init = {}, timeoutMs = NAC_FETCH_DEADLINE_MS) {
  const outer = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = outer
    ? setTimeout(() => outer.abort(), timeoutMs)
    : null;
  if (outer && init.signal) {
    if (init.signal.aborted) outer.abort();
    else init.signal.addEventListener("abort", () => outer.abort(), { once: true });
  }
  return fetch(input, outer ? { ...init, signal: outer.signal } : init).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
