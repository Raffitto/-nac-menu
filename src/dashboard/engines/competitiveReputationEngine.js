/**
 * Competitive Reputation Intelligence — NAC vs curated psychological competitors.
 */

import { branchDisplayName } from "../utils/rangeState";
import { BRANCH_GOOGLE_PLACE_IDS } from "../config/googleBranchPlaces";
import {
  competitorsForBranch,
  COMPETITOR_BRANCHES,
} from "../config/competitors";
import {
  getGooglePlaceMetrics,
  fetchBranchGooglePlaceMetrics,
} from "../services/googlePlacesService";
import {
  scoreCompetitiveThreat,
  threatTone,
} from "./competitiveThreatEngine";

/**
 * @param {string} branchId
 * @param {object} nacMetrics
 * @param {import('../config/competitors').CompetitorEntry} entry
 */
async function enrichCompetitor(branchId, nacMetrics, entry) {
  const metrics = entry.placeId
    ? await getGooglePlaceMetrics(entry.placeId)
    : {
        placeId: null,
        rating: null,
        totalReviews: null,
        displayName: entry.name,
        error: "missing_place_id",
      };

  const threat = scoreCompetitiveThreat(nacMetrics, {
    ...entry,
    metrics: {
      rating: metrics.rating,
      totalReviews: metrics.totalReviews,
      displayName: metrics.displayName || entry.name,
    },
  });

  return {
    ...entry,
    branchId,
    metrics,
    threat,
    tone: threatTone(threat.level),
    momentum: null,
    weeklySnapshotReady: false,
    displayName: metrics.displayName || entry.name,
  };
}

/**
 * @param {string} branchId
 */
export async function buildBranchCompetitiveIntel(branchId) {
  const id = String(branchId || "khobar").toLowerCase();
  const nacRaw = await getGooglePlaceMetrics(BRANCH_GOOGLE_PLACE_IDS[id]);
  const nac = {
    branchId: id,
    branchLabel: branchDisplayName(id),
    placeId: BRANCH_GOOGLE_PLACE_IDS[id],
    rating: nacRaw.rating,
    totalReviews: nacRaw.totalReviews,
    displayName: nacRaw.displayName || branchDisplayName(id),
    error: nacRaw.error,
  };

  const roster = competitorsForBranch(id);
  const competitors = await Promise.all(
    roster.map((c) => enrichCompetitor(id, nac, c)),
  );

  competitors.sort((a, b) => (b.threat?.score ?? 0) - (a.threat?.score ?? 0));

  const narrative = buildExecutiveNarrative(nac, competitors);
  const battlefield = summarizeBattlefield(nac, competitors);

  return {
    branchId: id,
    branchLabel: nac.branchLabel,
    nac,
    competitors,
    narrative,
    battlefield,
    fetchedAt: Date.now(),
  };
}

export async function buildNetworkCompetitiveIntel() {
  const nacByBranch = await fetchBranchGooglePlaceMetrics(null);
  const branches = await Promise.all(
    COMPETITOR_BRANCHES.map(async (branchId) => {
      const nac = {
        branchId,
        branchLabel: branchDisplayName(branchId),
        placeId: BRANCH_GOOGLE_PLACE_IDS[branchId],
        rating: nacByBranch[branchId]?.rating ?? null,
        totalReviews: nacByBranch[branchId]?.totalReviews ?? null,
        displayName:
          nacByBranch[branchId]?.displayName || branchDisplayName(branchId),
        error: nacByBranch[branchId]?.error,
      };

      const competitors = await Promise.all(
        competitorsForBranch(branchId).map((c) => enrichCompetitor(branchId, nac, c)),
      );
      competitors.sort((a, b) => (b.threat?.score ?? 0) - (a.threat?.score ?? 0));

      return {
        branchId,
        branchLabel: nac.branchLabel,
        nac,
        competitors,
        narrative: buildExecutiveNarrative(nac, competitors),
        battlefield: summarizeBattlefield(nac, competitors),
      };
    }),
  );

  return {
    branches,
    networkNarrative: buildNetworkNarrative(branches),
    fetchedAt: Date.now(),
  };
}

function summarizeBattlefield(nac, competitors) {
  const withMetrics = competitors.filter((c) => c.metrics?.rating != null);
  const topThreat = [...competitors].sort(
    (a, b) => (b.threat?.score ?? 0) - (a.threat?.score ?? 0),
  )[0];

  const ratingLeads = withMetrics.filter(
    (c) => (c.metrics.rating ?? 0) > (nac.rating ?? 0),
  ).length;

  return {
    competitorCount: competitors.length,
    trackedLive: withMetrics.length,
    ratingLeads,
    topThreatName: topThreat?.name || "—",
    topThreatLevel: topThreat?.threat?.label || "—",
    nacRating: nac.rating,
    nacReviews: nac.totalReviews,
  };
}

function buildExecutiveNarrative(nac, competitors) {
  const lines = [];
  const label = nac.branchLabel || "Branch";
  const top = [...competitors].sort(
    (a, b) => (b.threat?.score ?? 0) - (a.threat?.score ?? 0),
  )[0];

  if (nac.rating == null) {
    lines.push(`${label}: connect Google Places metrics to open the reputation battlefield.`);
    return lines;
  }

  const directLuxury = competitors.filter(
    (c) => c.type === "direct" && c.premiumPositioning && c.metrics?.rating != null,
  );
  const ahead = directLuxury.filter((c) => (c.metrics.rating ?? 0) > (nac.rating ?? 0));

  if (ahead.length >= 2) {
    lines.push(
      `${label} trails direct luxury competitors on public Google trust — same-guest-mood battlefield.`,
    );
  } else if (ahead.length === 1 && top) {
    lines.push(
      `${label} is reputation-vulnerable versus ${top.name} (${top.category}) — ${top.distance}.`,
    );
  } else if ((nac.rating ?? 0) >= 4.3 && ahead.length === 0) {
    lines.push(`${label} holds rating leadership against curated premium set.`);
  }

  const volumeLead = competitors.find(
    (c) =>
      (c.metrics?.totalReviews ?? 0) > (nac.totalReviews ?? 0) * 1.4 &&
      c.metrics?.rating != null,
  );
  if (volumeLead && (nac.totalReviews ?? 0) > 100) {
    lines.push(
      `${volumeLead.name} carries heavier review social proof — monitor dessert/café share of voice.`,
    );
  } else if ((nac.totalReviews ?? 0) >= 500 && !volumeLead) {
    lines.push("Review momentum advantage maintained versus curated competitive set.");
  }

  if (top?.threat?.level === "critical" || top?.threat?.level === "high") {
    lines.push(
      `Priority watch: ${top.name} — ${top.threat.factors?.[0] || "premium competitive pressure"}.`,
    );
  }

  if (!lines.length) {
    lines.push(`${label} competitive posture stable — continue card-handoff excellence on floor.`);
  }

  return lines.slice(0, 4);
}

function buildNetworkNarrative(branches) {
  const hot = branches.filter((b) =>
    b.competitors.some((c) => c.threat?.level === "critical" || c.threat?.level === "high"),
  );
  if (!hot.length) {
    return "Network reputation posture balanced across curated luxury competitive sets.";
  }
  const names = hot.map((b) => b.branchLabel).join(", ");
  return `${names} face elevated competitive reputation pressure — executive review recommended.`;
}
