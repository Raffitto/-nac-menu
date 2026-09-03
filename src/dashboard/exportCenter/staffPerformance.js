import { canonicalStaffName, isManagerRole, isWaiterRole } from "../config/staffRoles";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function itemName(row) {
  return String(row.matched_menu_item_name || row.raw_item_name || "").trim();
}

export function parseGuestsFromCreatorRow(row) {
  const cat = String(row.category || "");
  const m = cat.match(/guests:(\d+)/i);
  if (m) return Number(m[1]);
  if (row.guest_count != null) return num(row.guest_count);
  return null;
}

export function buildAverageCheckRows(creatorRows = []) {
  const byStaff = {};
  (creatorRows || []).forEach((row) => {
    const name = canonicalStaffName(row.waiter_name || row.raw_item_name);
    if (!name || isManagerRole(name) || !isWaiterRole(name)) return;
    if (!byStaff[name]) {
      byStaff[name] = { staff: name, netSales: 0, orders: 0, guests: 0 };
    }
    byStaff[name].netSales += num(row.net_sales ?? row.gross_sales);
    byStaff[name].orders += num(row.quantity_sold);
    const guests = parseGuestsFromCreatorRow(row);
    if (guests != null) byStaff[name].guests += guests;
  });

  return Object.values(byStaff)
    .map((row) => {
      const denom = row.guests > 0 ? row.guests : row.orders;
      const avgCheck = denom > 0 ? Math.round((row.netSales / denom) * 100) / 100 : 0;
      return { ...row, avgCheck, netSales: Math.round(row.netSales) };
    })
    .sort((a, b) => b.avgCheck - a.avgCheck || b.netSales - a.netSales)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function buildReviewRanking(reviewStats = []) {
  return (reviewStats || [])
    .filter((s) => s.name && isWaiterRole(s.name) && !isManagerRole(s.name))
    .map((s) => ({
      staff: canonicalStaffName(s.name),
      reviews: num(s.google ?? s.review_count),
    }))
    .sort((a, b) => b.reviews - a.reviews || a.staff.localeCompare(b.staff))
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function buildUpsellModel(productRows = [], { targetItems = null } = {}) {
  const byStaff = {};
  const byItem = {};

  (productRows || []).forEach((row) => {
    const staff = canonicalStaffName(row.waiter_name);
    if (!staff || isManagerRole(staff) || !isWaiterRole(staff)) return;
    const item = itemName(row);
    if (!item || item === "__creator__") return;
    if (targetItems && !targetItems.some((t) => item.toLowerCase().includes(String(t).toLowerCase()))) {
      return;
    }
    const qty = num(row.quantity_sold);
    const sales = num(row.gross_sales ?? row.net_sales);
    if (!byStaff[staff]) byStaff[staff] = { staff, qty: 0, sales: 0 };
    byStaff[staff].qty += qty;
    byStaff[staff].sales += sales;
    if (!byItem[item]) byItem[item] = { item, total: 0, byStaff: {} };
    byItem[item].total += qty;
    byItem[item].byStaff[staff] = (byItem[item].byStaff[staff] || 0) + qty;
  });

  const totalQty = Object.values(byStaff).reduce((s, r) => s + r.qty, 0);
  const topUpsellers = Object.values(byStaff)
    .map((r) => ({
      ...r,
      sales: Math.round(r.sales),
      share: totalQty > 0 ? Math.round((r.qty / totalQty) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.qty - a.qty || b.sales - a.sales)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const whoSoldWhat = Object.values(byItem)
    .map((entry) => {
      const ranked = Object.entries(entry.byStaff)
        .sort((a, b) => b[1] - a[1])
        .map(([staff, qty]) => ({ staff, qty }));
      return {
        item: entry.item,
        first: ranked[0] || null,
        second: ranked[1] || null,
        third: ranked[2] || null,
        total: entry.total,
      };
    })
    .sort((a, b) => b.total - a.total);

  const staffNames = [...new Set(topUpsellers.map((s) => s.staff))];
  const matrix = Object.values(byItem)
    .sort((a, b) => a.item.localeCompare(b.item))
    .map((entry) => {
      const row = { item: entry.item, total: entry.total };
      staffNames.forEach((name) => {
        row[name] = entry.byStaff[name] || 0;
      });
      return row;
    });

  return { topUpsellers, whoSoldWhat, matrix, staffNames };
}

export function buildStaffPerformanceReport({
  creatorRows = [],
  productRows = [],
  reviewStats = [],
  branch = "khobar",
  from,
  to,
} = {}) {
  const averageCheck = buildAverageCheckRows(creatorRows);
  const reviews = buildReviewRanking(reviewStats);
  const upsell = buildUpsellModel(productRows);
  return {
    branch,
    from,
    to,
    averageCheck,
    reviews,
    ...upsell,
  };
}
