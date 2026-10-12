// Recording wrapper around the REAL supabase/functions/_shared/vaultReviewTrackingDriveDiscovery.ts.
// The "?real" suffix bypasses the import-map entry that points here, so the real discovery and
// authorization logic runs (with Drive I/O served by stubs/vaultDriveIngestion.ts).
import * as real from "../../../supabase/functions/_shared/vaultReviewTrackingDriveDiscovery.ts?real";
import { state } from "./state.ts";

export const REVIEW_TRACKING_BRANCH = real.REVIEW_TRACKING_BRANCH;
export const findReviewTrackingDriveFiles = real.findReviewTrackingDriveFiles;
export const ensureReviewTrackingHostFolder = real.ensureReviewTrackingHostFolder;
export const ingestReviewTrackingHits = real.ingestReviewTrackingHits;

export async function ingestConnectedReviewTracking(admin: any, opts: any) {
  state.reviewTrackingIngests.push({ triggerType: opts?.triggerType });
  return await real.ingestConnectedReviewTracking(admin, opts);
}
export async function resolveReviewTrackingHits(admin: any, opts: any) {
  state.reviewTrackingResolves.push({ connectionId: opts?.connectionId, branchId: opts?.branchId });
  return await real.resolveReviewTrackingHits(admin, opts);
}
