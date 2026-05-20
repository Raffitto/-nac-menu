/**
 * Future-ready competitor snapshot storage (Phase 13+).
 * Weekly captures, velocity, trend arrows — not wired to UI yet.
 */

/**
 * @typedef {object} CompetitiveSnapshot
 * @property {string} branchId
 * @property {number} capturedAt — epoch ms
 * @property {object} nac — { rating, totalReviews }
 * @property {Array} competitors — id + metrics + threat
 * @property {number} version
 */

export const SNAPSHOT_VERSION = 1;

/** @returns {CompetitiveSnapshot} */
export function createCompetitiveSnapshot(branchIntel) {
  return {
    branchId: branchIntel.branchId,
    capturedAt: Date.now(),
    nac: {
      rating: branchIntel.nac?.rating,
      totalReviews: branchIntel.nac?.totalReviews,
    },
    competitors: (branchIntel.competitors || []).map((c) => ({
      id: c.id,
      rating: c.metrics?.rating,
      totalReviews: c.metrics?.totalReviews,
      threatLevel: c.threat?.level,
    })),
    version: SNAPSHOT_VERSION,
  };
}

/** Placeholder for review velocity / momentum (future). */
export function computeMomentumPlaceholder(_previous, _current) {
  return {
    ratingDelta: null,
    reviewVelocity: null,
    trendArrow: null,
    label: "Momentum tracking soon",
  };
}
