import { foodicsDedupeKey, normalizeFoodicsName } from "./foodicsNameNormalize";

function addNum(a, b) {
  const x = Number(a) || 0;
  const y = Number(b) || 0;
  return x + y;
}

/**
 * Merge import rows with identical normalized names (sum qty/sales).
 */
export function dedupeImportRows(rows) {
  const groups = new Map();

  for (const row of rows || []) {
    const key = foodicsDedupeKey(row.raw_item_name || row.name);
    if (!key) continue;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...row,
        normalized_item_name: key,
        raw_variants: [row.raw_item_name || row.name].filter(Boolean),
        variant_count: 1,
      });
      continue;
    }

    existing.quantity_sold = addNum(existing.quantity_sold, row.quantity_sold);
    existing.net_sales = addNum(existing.net_sales, row.net_sales);
    existing.gross_sales = addNum(existing.gross_sales, row.gross_sales);
    existing.discount = addNum(existing.discount, row.discount);
    const raw = row.raw_item_name || row.name;
    if (raw && !existing.raw_variants.includes(raw)) {
      existing.raw_variants.push(raw);
    }
    existing.variant_count = existing.raw_variants.length;
    if ((row.net_sales || 0) > (existing.net_sales || 0) && raw) {
      existing.raw_item_name = raw;
    }
  }

  return Array.from(groups.values());
}

/** One review row per normalized Foodics name */
export function groupNeedsReviewRows(rows) {
  const groups = new Map();

  for (const row of rows || []) {
    if (row.import_status !== "needs_review") continue;
    const key = foodicsDedupeKey(row.raw_item_name);
    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        normalized_item_name: key,
        raw_variants: [row.raw_item_name].filter(Boolean),
        variant_count: 1,
      });
    } else {
      const g = groups.get(key);
      g.variant_count += 1;
      if (row.raw_item_name && !g.raw_variants.includes(row.raw_item_name)) {
        g.raw_variants.push(row.raw_item_name);
      }
      if ((row.suggested_confidence || row.match_confidence || 0) > (g.suggested_confidence || g.match_confidence || 0)) {
        Object.assign(g, {
          suggested_menu_item_name: row.suggested_menu_item_name,
          suggested_confidence: row.suggested_confidence,
          match_confidence: row.match_confidence,
          match_type: row.match_type,
        });
      }
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => (b.variant_count || 1) - (a.variant_count || 1),
  );
}

export function displayFoodicsLabel(row) {
  const variants = row.raw_variants || [row.raw_item_name];
  const primary = variants[0] || row.raw_item_name || "—";
  if (variants.length <= 1) return primary;
  return `${primary} (+${variants.length - 1} variant${variants.length > 2 ? "s" : ""})`;
}

export { normalizeFoodicsName };
