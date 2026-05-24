/**
 * Executive briefing — deterministic operational language (no speculative AI).
 */

import { formatSarMoney } from "../../utils/sarMoneyFormat";

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

export function pctOf(part, total) {
  if (!total || total <= 0) return 0;
  return round1((Number(part) / Number(total)) * 100);
}

export function formatPct(n) {
  return `${round1(n)}%`;
}

/** Rule-based bottom-item operational label. */
export function classifyBottomItemAction(row, { totalProductQty = 0, medianQty = 0 } = {}) {
  const qty = Number(row.quantity) || 0;
  const share = pctOf(qty, totalProductQty);
  const name = String(row.item_name || "").toLowerCase();
  const cls = String(row.foodics_class || "").toLowerCase();

  if (qty <= 1 && share < 0.3) {
    return {
      action_label: "Possible removal candidate",
      action_note: "Minimal volume in period — validate menu placement before delisting.",
    };
  }
  if (qty <= 3 && share < 1) {
    return {
      action_label: "Weak demand",
      action_note: "Below typical item velocity — monitor next import cycle.",
    };
  }
  if (
    (name.includes("seasonal") ||
      name.includes("ramadan") ||
      name.includes("eid") ||
      (cls === "drink" && qty < medianQty * 0.4))
  ) {
    return {
      action_label: "Seasonal item",
      action_note: "Low period volume may reflect seasonality, not permanent weakness.",
    };
  }
  if (row.matched_menu_item_name && qty < medianQty) {
    return {
      action_label: "Needs visibility",
      action_note: "Mapped menu item with limited sales — consider placement or staff recommendation.",
    };
  }
  return {
    action_label: "Candidate for repositioning",
    action_note: "Volume is below menu median — test category placement or pairing.",
  };
}

export function buildGooglePerformanceInsights(rows = [], totals = {}) {
  const list = rows || [];
  const totalScans = Number(totals.qr_scans) || list.reduce((a, r) => a + (r.qr_scans || 0), 0);
  const totalGoogle = Number(totals.google_redirects) || list.reduce((a, r) => a + (r.google_redirects || 0), 0);
  const scansWithoutRedirect = Math.max(0, totalScans - totalGoogle);
  const redirectEfficiency = pctOf(totalGoogle, totalScans);

  const topCloser = [...list].sort(
    (a, b) => b.google_redirects - a.google_redirects || b.conversion_pct - a.conversion_pct,
  )[0];

  return {
    total_scans: totalScans,
    total_google_redirects: totalGoogle,
    scans_without_redirect: scansWithoutRedirect,
    redirect_efficiency_pct: redirectEfficiency,
    top_review_closer: topCloser
      ? {
          waiter: topCloser.waiter,
          google_redirects: topCloser.google_redirects,
          conversion_pct: topCloser.conversion_pct,
        }
      : null,
  };
}

export function buildOperationalConcern({
  waiterIntel = null,
  khobarGoogle = null,
  bottomItems = [],
  periodPartial = false,
}) {
  if (periodPartial) {
    return {
      title: "Period coverage gap",
      body: "Operational sales import, menu tracking, or review events do not fully cover the selected report range. Treat rankings as partial-period only.",
    };
  }

  const waiters = waiterIntel?.waiters || waiterIntel?.all || [];
  const avgModifier =
    waiters.length > 0
      ? waiters.reduce((a, w) => a + (w.modifierAttachPct || 0), 0) / waiters.length
      : 0;
  if (avgModifier > 0 && avgModifier < 8) {
    return {
      title: "Low modifier attachment",
      body: `Team modifier attach averages ${formatPct(avgModifier)} — floor upsell on sauces and add-ons may be under-captured.`,
    };
  }

  const avgDessert =
    waiters.length > 0
      ? waiters.reduce((a, w) => a + (w.dessertAttachPct || 0), 0) / waiters.length
      : 0;
  if (avgDessert > 0 && avgDessert < 6) {
    return {
      title: "Weak dessert attach",
      body: `Dessert attach averages ${formatPct(avgDessert)} — dessert visibility or closing prompts may need reinforcement.`,
    };
  }

  const googleRows = khobarGoogle?.rows || [];
  const totalRedirects = googleRows.reduce((a, r) => a + (r.google_redirects || 0), 0);
  if (totalRedirects > 0 && googleRows[0]) {
    const topShare = pctOf(googleRows[0].google_redirects, totalRedirects);
    if (topShare >= 35) {
      return {
        title: "Review participation imbalance",
        body: `${googleRows[0].waiter} accounts for ${formatPct(topShare)} of Khobar Google redirects — broaden review coaching across the floor.`,
      };
    }
  }

  if (bottomItems.length >= 5) {
    const weakCount = bottomItems.filter((r) =>
      ["Weak demand", "Possible removal candidate"].includes(r.action_label),
    ).length;
    if (weakCount >= 4) {
      return {
        title: "Menu tail weakness",
        body: `${weakCount} items in the lowest sellers show weak demand — review menu breadth and placement.`,
      };
    }
  }

  return {
    title: "No critical operational flag",
    body: "Core sales, upsell, and review metrics are within expected variance for this period.",
  };
}

export function buildRecommendedAction(concern) {
  const map = {
    "Period coverage gap":
      "Re-import operational sales (Foodics by creator) for the exact report dates before board review.",
    "Low modifier attachment":
      "Run a focused modifier upsell huddle; track sauce and premium beverage attach next period.",
    "Weak dessert attach":
      "Feature desserts on the digital menu and reinforce closing scripts during peak hours.",
    "Review participation imbalance":
      "Pair top review converters with lower-participation waiters for shift coaching.",
    "Menu tail weakness":
      "Audit bottom sellers for placement, pricing, and removal candidates in the next menu cycle.",
  };
  return map[concern?.title] || "Continue monitoring Foodics imports and Khobar review scan participation weekly.";
}

export function buildExecutiveSummaryPage(ctx) {
  const {
    meta,
    trust,
    topItems,
    bottomItems,
    waiterSales,
    waiterUpsell,
    khobarGoogle,
    periodAlignment,
    waiterIntel,
  } = ctx;

  const topSeller = topItems?.rows?.[0] || null;
  const weakest = bottomItems?.rows?.[0] || null;
  const topWaiter = waiterSales?.rows?.[0] || null;
  const topUpseller = waiterUpsell?.rows?.[0] || null;
  const topGoogle = khobarGoogle?.rows?.[0] || null;

  const totalWaiterNet = waiterSales?.footer?.net_sales || 0;
  const concern = buildOperationalConcern({
    waiterIntel,
    khobarGoogle,
    bottomItems: bottomItems?.rows || [],
    periodPartial: periodAlignment?.reportPartial,
  });

  return {
    period: meta.periodLabel,
    branch: meta.branchLabel,
    generated_at: meta.generatedAtLabel,
    operational_trust_score: trust?.score ?? null,
    operational_trust_tier: trust?.tier ?? null,
    data_confidence: trust?.confidenceLabel ?? "Provisional",
    period_coverage_note: periodAlignment?.coverageNote || null,
    top_seller: topSeller
      ? {
          item: topSeller.item_name,
          qty: topSeller.display_quantity,
          sales: topSeller.display_net_sales,
          contribution_pct: topSeller.display_contribution,
        }
      : null,
    weakest_seller: weakest
      ? {
          item: weakest.item_name,
          qty: weakest.display_quantity,
          sales: weakest.display_net_sales,
          note: weakest.action_note || weakest.action_label,
        }
      : null,
    top_waiter: topWaiter
      ? {
          name: topWaiter.waiter,
          sales: topWaiter.display_net_sales,
          contribution_pct: topWaiter.display_contribution,
        }
      : null,
    top_upseller: topUpseller
      ? {
          name: topUpseller.waiter,
          qty: topUpseller.display_quantity,
          sales: topUpseller.display_net_sales,
          contribution_pct: topUpseller.display_contribution,
        }
      : null,
    top_google_converter: topGoogle
      ? {
          name: topGoogle.waiter,
          redirects: topGoogle.google_redirects,
          conversion_pct: formatPct(topGoogle.conversion_pct),
          contribution_pct: topGoogle.display_contribution,
        }
      : null,
    operational_concern: concern,
    recommended_action: buildRecommendedAction(concern),
    total_waiter_net_display: formatSarMoney(totalWaiterNet),
  };
}

export function buildExecutiveReportFilename(meta) {
  const branch = (meta.branchId || "network")
    .split(/[\s_-]+/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join("");
  const start = meta.exportStartDate || "start";
  const end = meta.exportEndDate || "end";
  return `NAC-Executive-Report-${branch}-${start}_to_${end}`;
}
