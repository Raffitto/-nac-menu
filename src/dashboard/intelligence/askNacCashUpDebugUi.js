/**
 * Cash-up debug panel visibility — data remains on response; UI gate only.
 */

export function shouldShowCashUpDebugPanel() {
  return String(process.env.REACT_APP_ASK_NAC_CASHUP_DEBUG || "").trim().toLowerCase() === "true";
}
