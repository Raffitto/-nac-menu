import { isAdminPlatformMode } from "../../lib/platformMode";

/**
 * Single Operational Dashboard surface (replaces legacy Overview Operations + Session tabs).
 *
 * - Explicit `REACT_APP_UNIFIED_OVERVIEW=1` → always on
 * - Explicit `REACT_APP_UNIFIED_OVERVIEW=0` → legacy Overview tabs (opt-out)
 * - Default on admin platform builds (nac-os / NAC Hospitality OS) so production does not
 *   require a separate Netlify env var to pick up integrity fixes in OperationalDashboard.jsx
 */
export function isUnifiedOverviewEnabled() {
  const flag = process.env.REACT_APP_UNIFIED_OVERVIEW;
  if (flag === "0") return false;
  if (flag === "1") return true;
  return isAdminPlatformMode();
}
