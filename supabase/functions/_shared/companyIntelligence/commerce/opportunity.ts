/**
 * Deterministic opportunity estimates. Always labeled as estimates, never forecasts.
 * Uses current branch volume × alternative mix × current branch archetype check values
 * so overlapping mix shifts are not double-counted against a second volume scenario
 * unless that scenario is requested separately.
 */

import { averageCheck } from "./metrics.ts";
import type { OpportunityEstimate, ServiceMixResult, TableArchetype } from "./types.ts";

const MIX_KEYS: TableArchetype[] = [
  "dessert_only",
  "coffee_only",
  "dessert_and_coffee",
  "food_only",
  "food_and_beverage",
  "full_service",
  "beverage_only",
  "unclassified",
];

function shareOf(mix: ServiceMixResult, key: TableArchetype): number {
  if (!mix.totalSessions) return 0;
  return mix.byArchetype[key].sessions / mix.totalSessions;
}

export function modeledSalesFromMix(
  volumeSessions: number,
  mix: ServiceMixResult,
  checkSource: ServiceMixResult,
): number | null {
  if (!volumeSessions || !mix.totalSessions) return null;
  let total = 0;
  for (const key of MIX_KEYS) {
    const check = averageCheck(checkSource.byArchetype[key]) || 0;
    total += volumeSessions * shareOf(mix, key) * check;
  }
  return total;
}

export function currentVolumeAltMixOpportunity(
  current: ServiceMixResult,
  alternativeMix: ServiceMixResult,
  label: string,
): OpportunityEstimate | null {
  const estimate = modeledSalesFromMix(current.totalSessions, alternativeMix, current);
  if (estimate == null) return null;
  const currentSales = MIX_KEYS.reduce((s, k) => s + current.byArchetype[k].netSales, 0);
  return {
    label,
    estimateNetSales: estimate,
    deltaVsCurrent: estimate - currentSales,
    method: "current session volume × alternative archetype mix × current archetype average checks",
    isEstimate: true,
  };
}

export function currentMixAltVolumeOpportunity(
  current: ServiceMixResult,
  alternativeVolume: ServiceMixResult,
  label: string,
): OpportunityEstimate | null {
  const estimate = modeledSalesFromMix(alternativeVolume.totalSessions, current, current);
  if (estimate == null) return null;
  const currentSales = MIX_KEYS.reduce((s, k) => s + current.byArchetype[k].netSales, 0);
  return {
    label,
    estimateNetSales: estimate,
    deltaVsCurrent: estimate - currentSales,
    method: "alternative session volume × current archetype mix × current archetype average checks",
    isEstimate: true,
  };
}
