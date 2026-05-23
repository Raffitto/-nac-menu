/**
 * Branch operational score weights (0–1, must sum to 1).
 * Tune here without touching scoring logic.
 */
export const OPERATIONAL_SCORE_WEIGHTS = {
  tapToGoogleConversion: 0.22,
  staffParticipation: 0.18,
  staffConsistency: 0.12,
  reviewMomentum: 0.15,
  redirectEfficiency: 0.13,
  activityVolume: 0.1,
  reviewGrowthTrend: 0.1,
};

export const OPERATIONAL_SCORE_TIERS = [
  { id: "elite", label: "Elite", min: 90, max: 100 },
  { id: "strong", label: "Strong", min: 75, max: 89 },
  { id: "unstable", label: "Unstable", min: 60, max: 74 },
  { id: "critical", label: "Critical", min: 0, max: 59 },
];

/** Minimum samples before scoring (below → insufficient data). */
export {
  SCORE_MIN_CARD_TAPS,
  SCORE_MIN_STAFF_ACTIVE,
} from "../../platform/contracts/dataSufficiency";
