/** Deployment platform mode — public guest menu vs internal NAC OS admin site. */

export const PLATFORM_MODES = {
  PUBLIC: "public",
  ADMIN: "admin",
};

/**
 * Normalize REACT_APP_PLATFORM_MODE. Missing, empty, or invalid values → public.
 */
export function normalizePlatformMode(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === PLATFORM_MODES.ADMIN) return PLATFORM_MODES.ADMIN;
  return PLATFORM_MODES.PUBLIC;
}

export function getPlatformMode() {
  return normalizePlatformMode(process.env.REACT_APP_PLATFORM_MODE);
}

export function isAdminPlatformMode() {
  return getPlatformMode() === PLATFORM_MODES.ADMIN;
}

export function isPublicPlatformMode() {
  return !isAdminPlatformMode();
}

/**
 * Resolve which root experience to mount. Special routes take priority over platform mode.
 * Review QR detection is unchanged — callers pass the same flag as index.js.
 */
export function resolveRootAppKind({
  pathname = "/",
  isReviewQr = false,
  platformMode = getPlatformMode(),
} = {}) {
  const path = String(pathname || "/").replace(/\/$/, "") || "/";

  if (path === "/reset-password") return "reset-password";
  if (path === "/leaderboard") return "leaderboard";
  if (isReviewQr) return "review";
  if (path === "/inventory") return "inventory";
  if (normalizePlatformMode(platformMode) === PLATFORM_MODES.ADMIN) return "admin";
  return "public-menu";
}
