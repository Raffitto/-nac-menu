import { formatSarMoney } from "../../utils/sarMoneyFormat";
import { createEmptySection } from "./contract";
import { formatCoverageSubtitle, formatCoverageWarning } from "./periodAlignment";
import {
  pctOf,
  formatPct,
  classifyBottomItemAction,
  buildGooglePerformanceInsights,
} from "./insights";

function roundDisplayQty(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function rankRows(rows, sortFn, valueKeyForDisplay = "net_sales") {
  const sorted = [...rows].sort(sortFn);
  return sorted.map((row, index) => ({
    ...row,
    rank: index + 1,
    is_top_three: index < 3,
    rank_label: index < 3 ? `Top ${index + 1}` : String(index + 1),
    display_net_sales: formatSarMoney(row.net_sales ?? row[valueKeyForDisplay]),
    display_quantity: roundDisplayQty(row.quantity ?? row.qty),
  }));
}

function applyContribution(rows, total, valueKey = "net_sales") {
  return rows.map((r) => {
    const pct = pctOf(r[valueKey], total);
    return {
      ...r,
      contribution_pct: pct,
      display_contribution: formatPct(pct),
    };
  });
}

function tableFooterFromRows(rows, { qtyKey = "quantity", salesKey = "net_sales" } = {}) {
  const quantity = rows.reduce((a, r) => a + (Number(r[qtyKey]) || 0), 0);
  const net_sales = rows.reduce((a, r) => a + (Number(r[salesKey]) || 0), 0);
  return {
    quantity,
    net_sales,
    display_quantity: roundDisplayQty(quantity),
    display_net_sales: formatSarMoney(net_sales),
  };
}

export function buildTopItemsSection({ rows, coverage, integrityOk }) {
  const section = createEmptySection({
    id: "topItems",
    title: "Top 10 items by net quantity",
    subtitle: formatCoverageSubtitle(coverage),
  });
  section.coverage = coverage;
  section.note = formatCoverageWarning(coverage);

  if (coverage?.warning && !coverage?.aligned && !coverage?.partial) {
    section.rows = [];
    return section;
  }
  if (!rows?.length) {
    section.note = section.note || "No operational sales data for this period.";
    return section;
  }
  if (!integrityOk) {
    section.note = section.note || "Import totals could not be validated — rankings withheld.";
    return section;
  }

  const ranked = rankRows(rows, (a, b) => b.quantity - a.quantity || b.net_sales - a.net_sales);
  const totalQty = ranked.reduce((a, r) => a + r.quantity, 0);
  const withContrib = applyContribution(ranked, totalQty, "quantity").slice(0, 10);
  section.rows = withContrib;
  section.footer = {
    ...tableFooterFromRows(withContrib),
    display_contribution: "100%",
  };
  return section;
}

export function buildBottomItemsSection({ rows, coverage, integrityOk }) {
  const section = createEmptySection({
    id: "bottomItems",
    title: "Least 10 items by net quantity",
    subtitle: "Menu items, sides, add-ons, modifiers — promo/noise excluded",
  });
  section.coverage = coverage;
  section.note = formatCoverageWarning(coverage);

  if (coverage?.warning && !coverage?.aligned && !coverage?.partial) {
    section.rows = [];
    return section;
  }
  if (!rows?.length) {
    section.note = section.note || "No qualifying menu items with sales in this period.";
    return section;
  }
  if (!integrityOk) {
    section.note = section.note || "Import validation failed — section withheld.";
    return section;
  }

  const paidRows = rows.filter((r) => (Number(r.net_sales) || 0) > 0 && (Number(r.quantity) || 0) > 0);
  if (!paidRows.length) {
    section.note = section.note || "No paid menu items with net sales in this period.";
    return section;
  }

  const totalQty = paidRows.reduce((a, r) => a + r.quantity, 0);
  const sorted = [...paidRows].sort((a, b) => a.quantity - b.quantity || a.net_sales - b.net_sales);
  const medianQty = sorted[Math.floor(sorted.length / 2)]?.quantity || 0;

  const ranked = rankRows(sorted, (a, b) => a.quantity - b.quantity || a.net_sales - b.net_sales)
    .slice(0, 10)
    .map((r) => {
      const action = classifyBottomItemAction(r, { totalProductQty: totalQty, medianQty });
      return {
        ...r,
        ...action,
        contribution_pct: pctOf(r.quantity, totalQty),
        display_contribution: formatPct(pctOf(r.quantity, totalQty)),
      };
    });

  section.rows = ranked;
  section.footer = {
    ...tableFooterFromRows(ranked),
    display_contribution: "100%",
  };
  return section;
}

export function buildWaiterSalesSection({ rows, coverage, integrityOk }) {
  const section = createEmptySection({
    id: "waiterSales",
    title: "Waiter net sales ranking",
    subtitle: formatCoverageSubtitle(coverage),
  });
  section.coverage = coverage;
  section.note = formatCoverageWarning(coverage);

  if (coverage?.warning && !coverage.aligned && !coverage.partial) {
    section.rows = [];
    return section;
  }
  if (!rows?.length) {
    section.note = section.note || "No waiter product sales import for this period.";
    return section;
  }
  if (!integrityOk) {
    section.note = section.note || coverage?.warning || "Waiter import validation failed.";
    return section;
  }

  const ranked = rankRows(rows, (a, b) => b.net_sales - a.net_sales);
  const totalNet = ranked.reduce((a, r) => a + r.net_sales, 0);
  section.rows = applyContribution(ranked, totalNet, "net_sales");
  section.footer = {
    ...tableFooterFromRows(section.rows),
    display_contribution: "100%",
  };
  return section;
}

export function buildWaiterUpsellSection({ rows, coverage, focusLabel, integrityOk }) {
  const section = createEmptySection({
    id: "waiterUpsell",
    title: "Waiter upsell ranking",
    subtitle: focusLabel ? `Tracking: ${focusLabel}` : formatCoverageSubtitle(coverage),
  });
  section.coverage = coverage;

  if (!rows?.length) {
    section.note = "Select upsell groups or individual items in the export dialog.";
    return section;
  }
  if (!integrityOk) {
    section.note = "Waiter import unavailable for upsell ranking.";
    return section;
  }

  const ranked = rankRows(rows, (a, b) => b.quantity - a.quantity || b.net_sales - a.net_sales);
  const totalQty = ranked.reduce((a, r) => a + r.quantity, 0);
  const totalNet = ranked.reduce((a, r) => a + r.net_sales, 0);
  section.rows = applyContribution(ranked, totalQty, "quantity");
  section.footer = {
    quantity: totalQty,
    net_sales: totalNet,
    display_quantity: roundDisplayQty(totalQty),
    display_net_sales: formatSarMoney(totalNet),
    display_contribution: "100%",
  };
  return section;
}

export function buildKhobarGoogleSection({ rows, coverage }) {
  const section = createEmptySection({
    id: "khobarGoogle",
    title: "Khobar Google scan ranking",
    subtitle: `Review events: ${coverage?.batchLabel || "selected period"}`,
  });
  section.coverage = coverage;

  if (!rows?.length) {
    section.note = "No Khobar review scan events in this period.";
    return section;
  }

  const ranked = rankRows(
    rows.map((r) => ({
      ...r,
      net_sales: r.google_redirects,
    })),
    (a, b) => b.google_redirects - a.google_redirects || b.qr_scans - a.qr_scans,
    "google_redirects",
  );

  const totalGoogle = ranked.reduce((a, r) => a + (r.google_redirects || 0), 0);
  const totalScans = ranked.reduce((a, r) => a + (r.qr_scans || 0), 0);

  section.rows = ranked.map((r) => ({
    ...r,
    participation_pct: pctOf(r.qr_scans, totalScans),
    display_participation: formatPct(pctOf(r.qr_scans, totalScans)),
    contribution_pct: pctOf(r.google_redirects, totalGoogle),
    display_contribution: formatPct(pctOf(r.google_redirects, totalGoogle)),
    display_conversion: formatPct(r.conversion_pct),
    scans_without_redirect: Math.max(0, (r.qr_scans || 0) - (r.google_redirects || 0)),
  }));

  section.footer = {
    qr_scans: totalScans,
    google_redirects: totalGoogle,
    display_scans: roundDisplayQty(totalScans),
    display_redirects: roundDisplayQty(totalGoogle),
    redirect_efficiency_pct: pctOf(totalGoogle, totalScans),
    display_efficiency: formatPct(pctOf(totalGoogle, totalScans)),
  };

  section.insights = buildGooglePerformanceInsights(section.rows, {
    qr_scans: totalScans,
    google_redirects: totalGoogle,
  });

  return section;
}
