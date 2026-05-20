/**
 * Psychological competitive threat scoring — not pure statistics.
 */

import { THREAT_LEVELS } from "../config/competitors";

const TYPE_WEIGHT = { direct: 1.35, reputation: 1.15, traffic: 0.95 };

/**
 * @param {object} nac — { rating, totalReviews }
 * @param {object} competitor — curated entry + live metrics
 */
export function scoreCompetitiveThreat(nac, competitor) {
  const nacRating = nac?.rating ?? null;
  const nacReviews = nac?.totalReviews ?? 0;
  const compRating = competitor?.metrics?.rating ?? null;
  const compReviews = competitor?.metrics?.totalReviews ?? 0;

  if (compRating == null && compReviews === 0) {
    return {
      level: "watch",
      label: THREAT_LEVELS.watch.label,
      score: 40,
      factors: ["Awaiting live Google metrics — curated battlefield entry"],
      momentum: null,
    };
  }

  if (nacRating == null) {
    return {
      level: "watch",
      label: THREAT_LEVELS.watch.label,
      score: 50,
      factors: ["NAC public rating unavailable for comparison"],
      momentum: null,
    };
  }

  const ratingGap = (compRating ?? 0) - nacRating;
  const reviewRatio =
    nacReviews > 0 ? compReviews / nacReviews : compReviews > 200 ? 2 : 0;

  let psych = TYPE_WEIGHT[competitor.type] || 1;
  if (competitor.premiumPositioning) psych += 0.22;
  if (competitor.socialMood) psych += 0.08;
  if ((competitor.category || "").toLowerCase().includes("luxury")) psych += 0.12;

  let score = 50;
  const factors = [];

  if (ratingGap >= 0.35) {
    score += 28 * psych;
    factors.push("Material rating lead on Google trust");
  } else if (ratingGap >= 0.12) {
    score += 14 * psych;
    factors.push("Visible rating edge in guest decision window");
  } else if (ratingGap <= -0.12) {
    score -= 22;
    factors.push("NAC holds rating advantage");
  }

  if (reviewRatio >= 1.8 && compReviews >= 800) {
    score += 22 * psych;
    factors.push("Review volume dominance — social proof gravity");
  } else if (reviewRatio >= 1.1 && compReviews >= 400) {
    score += 12 * psych;
    factors.push("Heavier review corpus than NAC");
  } else if (reviewRatio < 0.65 && nacReviews >= 200) {
    score -= 10;
    factors.push("NAC review corpus leads");
  }

  if (compRating >= 4.65 && competitor.premiumPositioning && competitor.type === "direct") {
    score += 18;
    factors.push("Elite premium positioning — outsized psychological threat");
  }

  if (compRating < 4.0 && compReviews < 150) {
    score -= 18;
    factors.push("Weak public trust signal");
  }

  score = Math.round(Math.min(100, Math.max(0, score)));

  let level = "watch";
  if (score >= 82) level = "critical";
  else if (score >= 68) level = "high";
  else if (score >= 48) level = "watch";
  else if (score >= 32) level = "low";
  else level = "advantage";

  if (ratingGap <= -0.2 && reviewRatio < 0.9) level = "advantage";

  return {
    level,
    label: THREAT_LEVELS[level]?.label || level,
    score,
    factors: factors.slice(0, 3),
    ratingGap: Math.round(ratingGap * 10) / 10,
    reviewGap: compReviews - nacReviews,
    momentum: null,
    trendArrow: null,
  };
}

export function threatTone(level) {
  if (level === "advantage") return "gold";
  if (level === "low") return "teal";
  if (level === "watch") return "amber";
  if (level === "high" || level === "critical") return "red";
  return "amber";
}
