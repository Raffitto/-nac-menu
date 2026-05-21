/**
 * Branch comparison heatmap rows — normalized 0–100 per column for color scale.
 */

import { branchDisplayName } from "../utils/rangeState";

const COLUMNS = [
  { id: "operational_score", label: "Operational score" },
  { id: "redirect_efficiency", label: "Redirect efficiency" },
  { id: "review_momentum", label: "Review momentum" },
  { id: "participation_breadth", label: "Participation breadth" },
  { id: "google_review_growth", label: "Google review growth" },
  { id: "activity_volume", label: "Activity volume" },
];

function normGrowth(delta) {
  if (delta == null || !Number.isFinite(delta)) return null;
  if (delta >= 15) return 100;
  if (delta >= 8) return 85;
  if (delta >= 3) return 72;
  if (delta >= 0) return 55;
  if (delta >= -3) return 40;
  return 25;
}

function normVolume(scans, max) {
  const m = Math.max(max, 1);
  return Math.round((scans / m) * 100);
}

/**
 * @param {object} input
 */
export function buildExecutiveHeatmap(input = {}) {
  const status = input.branchStatus || [];
  const scoreByBranch = input.scoreByBranch || {};
  const maxScans = Math.max(...status.map((b) => b.qr_scans || 0), 1);

  const rows = status.map((b) => {
    const scoreRow = scoreByBranch[b.branch_id] || {};
    const factors = scoreRow.factors || {};
    const growth = normGrowth(b.review_growth);

    return {
      branch_id: b.branch_id,
      branch_name: b.branch_name || branchDisplayName(b.branch_id),
      cells: {
        operational_score: b.operational_score,
        redirect_efficiency: Math.round(factors.redirectEfficiency ?? b.conversion_pct ?? 0),
        review_momentum: Math.round(factors.reviewMomentum ?? 50),
        participation_breadth: b.participation_breadth,
        google_review_growth: growth,
        activity_volume: normVolume(b.qr_scans, maxScans),
      },
      raw: {
        qr_scans: b.qr_scans,
        google_redirects: b.google_redirects,
        conversion_pct: b.conversion_pct,
        review_growth_delta: b.review_growth,
      },
    };
  });

  return { columns: COLUMNS, rows };
}

export function sortHeatmapRows(rows = [], columnId = "operational_score", dir = "desc") {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a.cells[columnId];
    const bv = b.cells[columnId];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * mult;
  });
}
