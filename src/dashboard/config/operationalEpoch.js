/** Trusted NAC OS operational intelligence epoch (Asia/Riyadh calendar dates). */
export const NAC_ANALYTICS_EPOCH_START = "2026-05-14";

export function isOnOrAfterEpoch(dateKey) {
  if (!dateKey) return false;
  return String(dateKey).slice(0, 10) >= NAC_ANALYTICS_EPOCH_START;
}

export function isEpochExportRange(exportRange) {
  const start = exportRange?.startDate;
  if (!start) return true;
  return isOnOrAfterEpoch(start);
}
