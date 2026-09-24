const RELOAD_KEY = "nac-os-reloaded-build";

/**
 * Reload once when the server document is a newer build than this runtime.
 * A second mismatch for the same remote id does not reload again.
 */
export function decideBuildReload(current, remote, alreadyReloadedTo) {
  if (!current || !remote) return false;
  if (String(current).startsWith("local-")) return false;
  if (String(remote).includes("%")) return false;
  if (remote === current) return false;
  if (alreadyReloadedTo === remote) return false;
  return true;
}

export function readBuildIdFromHtml(html) {
  const match = String(html || "").match(/name="build-id"\s+content="([^"]+)"/);
  return match ? match[1] : null;
}

export function startBuildRecovery() {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const current = process.env.REACT_APP_BUILD_ID || "";
  let checking = false;

  const check = async () => {
    if (checking || document.visibilityState === "hidden") return;
    checking = true;
    try {
      const res = await fetch(`/index.html?nac_build=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const remote = readBuildIdFromHtml(await res.text());
      const already = sessionStorage.getItem(RELOAD_KEY);
      if (!decideBuildReload(current, remote, already)) {
        if (remote && remote === current) sessionStorage.removeItem(RELOAD_KEY);
        return;
      }
      sessionStorage.setItem(RELOAD_KEY, remote);
      window.location.reload();
    } catch {
      /* keep the running runtime */
    } finally {
      checking = false;
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.setTimeout(check, 2500);
}
