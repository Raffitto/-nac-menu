// Offline stand-in for supabase/functions/_shared/vaultReviewTrackingDriveDiscovery.ts.
import { state } from "./state.ts";
export async function ingestConnectedReviewTracking(_admin: unknown, opts: Record<string, unknown>) {
  state.reviewTrackingIngests.push({ triggerType: opts?.triggerType });
  return { stub: true, triggerType: opts?.triggerType };
}
export async function resolveReviewTrackingHits(_admin: unknown, opts: Record<string, unknown>) {
  state.reviewTrackingResolves.push({ connectionId: opts?.connectionId, branchId: opts?.branchId });
  return [];
}
