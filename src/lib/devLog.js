/** Dev-only logging — stripped from production bundles when NODE_ENV=production. */

export function devLog(...args) {
  if (process.env.NODE_ENV === "development") {
    console.info(...args);
  }
}

export function devWarn(...args) {
  if (process.env.NODE_ENV === "development") {
    console.warn(...args);
  }
}
