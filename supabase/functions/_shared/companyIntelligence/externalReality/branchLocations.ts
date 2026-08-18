/**
 * Canonical branch coordinates — never live-geocode per request.
 * Khobar → Grand House Open Mall / Golden Belt district (Patio Mall cluster).
 */

import type { BranchId } from "../types.ts";
import { normalizeBranchId } from "../scope.ts";

export type BranchLocation = {
  branchId: BranchId;
  label: string;
  site: string;
  lat: number;
  lon: number;
  timezone: "Asia/Riyadh";
  geocodeSource: string;
  persist: true;
};

export const CANONICAL_BRANCH_LOCATIONS: Record<string, BranchLocation> = Object.freeze({
  khobar: {
    branchId: "khobar",
    label: "NAC Khobar",
    site: "Grand House Open Mall, Al Hizam Adh Dhahabi (Golden Belt), Al Khobar",
    lat: 26.3055,
    lon: 50.1965,
    timezone: "Asia/Riyadh",
    geocodeSource: "canonical_branch_location_registry_v1",
    persist: true,
  },
  riyadh: {
    branchId: "riyadh",
    label: "NAC Riyadh",
    site: "Riyadh city centroid (branch site pending precise pin)",
    lat: 24.7136,
    lon: 46.6753,
    timezone: "Asia/Riyadh",
    geocodeSource: "canonical_branch_location_registry_v1",
    persist: true,
  },
  jeddah: {
    branchId: "jeddah",
    label: "NAC Jeddah",
    site: "Jeddah city centroid (branch site pending precise pin)",
    lat: 21.5433,
    lon: 39.1728,
    timezone: "Asia/Riyadh",
    geocodeSource: "canonical_branch_location_registry_v1",
    persist: true,
  },
});

export function resolveBranchLocation(branchId: string | null | undefined): BranchLocation | null {
  const id = normalizeBranchId(branchId) || (branchId === "khobar" || branchId === "riyadh" || branchId === "jeddah" ? branchId : null);
  if (!id) return null;
  return CANONICAL_BRANCH_LOCATIONS[id] || null;
}
