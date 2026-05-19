import { normalizeFoodicsName } from "./foodicsNameNormalize";

/** Stable key: creator + SKU (preferred) or product name */
export function waiterImportDedupeKey(row) {
  const creator = normalizeFoodicsName(row.waiter_name || row.creator_name || "");
  const sku = normalizeFoodicsName(row.product_sku || "");
  const product = normalizeFoodicsName(row.raw_item_name || row.name || "");
  const productKey = sku || product;
  if (!creator || !productKey) return null;
  return `${creator}::${productKey}`;
}

function addNum(a, b) {
  return (Number(a) || 0) + (Number(b) || 0);
}

/**
 * Merge only identical creator + product rows (never across creators).
 */
export function dedupeWaiterImportRows(rows) {
  const groups = new Map();
  const passthrough = [];

  for (const row of rows || []) {
    const key = waiterImportDedupeKey(row);
    if (!key) {
      passthrough.push(row);
      continue;
    }

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...row,
        normalized_item_name: normalizeFoodicsName(row.raw_item_name || row.name),
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
  }

  return [...groups.values(), ...passthrough];
}

/**
 * Sales by Creator exports often leave Creator blank on continuation rows (merged cells).
 */
export function forwardFillCreators(rows) {
  let lastCreator = "";
  return (rows || []).map((row) => {
    const trimmed = String(row.waiter_name || row.creator_name || "").trim();
    if (trimmed) lastCreator = trimmed;
    const waiter_name = trimmed || lastCreator || null;
    return { ...row, waiter_name, creator_name: waiter_name };
  });
}

export function rowHasCreator(row) {
  return Boolean(String(row?.waiter_name || row?.creator_name || "").trim());
}

export function rowHasSales(row) {
  return (
    (Number(row?.quantity_sold) || 0) > 0 ||
    (Number(row?.gross_sales) || 0) > 0 ||
    (Number(row?.net_sales) || 0) > 0
  );
}

/** Waiter lane: save every creator line with sales (menu match optional). */
export function isWaiterSavableRow(row) {
  return rowHasCreator(row) && rowHasSales(row);
}

function sumRows(rows) {
  return (rows || []).reduce(
    (acc, r) => ({
      gross: acc.gross + (Number(r.gross_sales) || 0),
      qty: acc.qty + (Number(r.quantity_sold) || 0),
    }),
    { gross: 0, qty: 0 },
  );
}

export function buildWaiterImportDebug({ parsedRaw = [], previewRows = [], importable = [] }) {
  const savableRaw = parsedRaw.filter(isWaiterSavableRow);
  const rawSums = sumRows(savableRaw);
  const saveSums = sumRows(importable);
  const zeroExcluded = previewRows.filter((r) => rowHasCreator(r) && !rowHasSales(r)).length;

  return {
    rawRowsParsed: parsedRaw.length,
    rowsWithCreator: parsedRaw.filter(rowHasCreator).length,
    rowsWithCreatorAndSales: savableRaw.length,
    rawGross: rawSums.gross,
    rawQty: rawSums.qty,
    rowsAfterMatch: previewRows.filter(isWaiterSavableRow).length,
    rowsZeroExcluded: zeroExcluded,
    rowsSaved: importable.length,
    saveGross: saveSums.gross,
    saveQty: saveSums.qty,
    rowsUnmatchedButSaved: importable.filter((r) => !r.matched_menu_item_name).length,
    rowsWithoutCreator: parsedRaw.filter((r) => !rowHasCreator(r)).length,
  };
}
