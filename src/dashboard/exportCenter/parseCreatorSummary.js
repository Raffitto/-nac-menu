import { findFoodicsHeaderAndData } from "../utils/foodicsParser";

function norm(h) {
  return String(h || "").toLowerCase().trim();
}

function parseNumber(val) {
  if (val == null || val === "") return null;
  const n = Number(String(val).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function findHeader(headers, candidates) {
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const cand of candidates) {
    const hit = normalized.find((h) => h.n === cand || h.n.includes(cand));
    if (hit) return hit.raw;
  }
  return null;
}

export function parseCreatorSummaryFromParsed(headers, dataRows) {
  return parseCreatorSummaryRows([headers, ...(dataRows || []).map((r) => (headers || []).map((h) => r[h]))]);
}

export function parseCreatorSummaryRows(matrix) {
  const { headers, dataRows } = findFoodicsHeaderAndData(matrix);
  const creator = findHeader(headers, ["creator", "waiter", "employee", "staff"]);
  const guests = findHeader(headers, ["guest", "guests", "covers"]);
  const orders = findHeader(headers, ["order count", "orders", "tickets"]);
  const net = findHeader(headers, ["net sales with tax", "net sales", "net total"]);
  const gross = findHeader(headers, ["gross sales", "total sales"]);
  if (!creator) return { rows: [], error: "Creator column not found." };

  const rows = dataRows.map((raw) => {
    const name = String(raw[creator] || "").trim();
    if (!name) return null;
    const guestCount = guests ? parseNumber(raw[guests]) : null;
    return {
      raw_item_name: "__creator__",
      waiter_name: name,
      creator_name: name,
      quantity_sold: orders ? parseNumber(raw[orders]) || 0 : 0,
      net_sales: net ? parseNumber(raw[net]) : null,
      gross_sales: gross ? parseNumber(raw[gross]) : null,
      category: guestCount != null ? `guests:${guestCount}` : "sales_by_creator",
    };
  }).filter(Boolean);

  const usable = rows.filter((row) => {
    const net = Number(row.net_sales);
    const ordersCount = Number(row.quantity_sold) || 0;
    return (Number.isFinite(net) && net !== 0) || ordersCount > 0;
  });

  return {
    rows: usable,
    error: usable.length
      ? null
      : rows.length
        ? "The file was received but no usable creator rows were stored. Please upload the file again."
        : "No Sales by Creator rows found.",
    headers,
    parsedRowCount: rows.length,
    usableRowCount: usable.length,
  };
}
