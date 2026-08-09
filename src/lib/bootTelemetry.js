/**
 * Lightweight cold-boot timings for development / nac-debug only.
 * Not shown to managers in the UI.
 */

const marks = Object.create(null);

function canLog() {
  if (typeof window === "undefined") return false;
  try {
    return (
      process.env.NODE_ENV !== "production" ||
      window.__NAC_PERF__ === true ||
      window.localStorage?.getItem("nac.debug") === "1"
    );
  } catch {
    return false;
  }
}

export function markBoot(name) {
  if (typeof performance === "undefined") return;
  marks[name] = performance.now();
  if (canLog()) {
    // eslint-disable-next-line no-console
    console.debug(`[nac-boot] ${name}`, Math.round(marks[name]), "ms");
  }
  if (typeof window !== "undefined") {
    window.__NAC_BOOT__ = { ...marks };
  }
}

export function bootMarks() {
  return { ...marks };
}
