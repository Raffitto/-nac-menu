/**
 * Personalized NAC review text generator — unified humanization engine (all branches).
 */

import { generateHumanizedReview } from "./reviewGeneratorEngine";
import {
  canonName,
  withHonorificEN,
  withHonorificAR,
} from "./reviewGeneratorShared";

export { canonName, withHonorificEN, withHonorificAR };

export const GOOGLE_PLACE_IDS = {
  khobar: "ChIJp_zLEdvpST4RPD2r1GX-ASw",
  jeddah: "ChIJg_3_793bwxUR6w9WMTA96F8",
  riyadh: "ChIJWVLeDGEdLz4RNTDq3dMM4nM",
};

/**
 * @param {{ staffName?: string, role?: string, branchId?: string, language?: string, scanTime?: Date|string|number }} opts
 */
export function generatePersonalizedReview(opts = {}) {
  return generateHumanizedReview({
    staffName: opts.staffName,
    role: opts.role,
    branchId: (opts.branchId || "khobar").toLowerCase(),
    language: opts.language,
    scanTime: opts.scanTime,
  });
}

export function getGoogleReviewUrl(branchId) {
  const placeId = GOOGLE_PLACE_IDS[(branchId || "khobar").toLowerCase()];
  if (!placeId) return null;
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}
