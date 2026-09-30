export function summarizePriceHistory({ history = [], branchId = null, now = new Date() } = {}) {
  const rows = (history || [])
    .filter((row) => !branchId || (row.branch_id || row.branchId) === branchId)
    .filter((row) => row.canonical_unit_cost != null || row.canonicalUnitCost != null)
    .sort((a, b) => new Date(at(b)).getTime() - new Date(at(a)).getTime());
  const latest = rows[0] || null;
  const previous = rows[1] || null;
  const latestValue = latest ? Number(latest.canonical_unit_cost ?? latest.canonicalUnitCost) : null;
  const previousValue = previous ? Number(previous.canonical_unit_cost ?? previous.canonicalUnitCost) : null;
  const change = latestValue != null && previousValue != null
    ? {
      absolute: String(latestValue - previousValue),
      percent: previousValue === 0 ? null : String(((latestValue - previousValue) / previousValue) * 100),
    }
    : { absolute: null, percent: null };

  return {
    latest: latest
      ? { value: String(latestValue), effectiveAt: at(latest), invoiceId: latest.invoice_id || latest.invoiceId || null, supplierId: latest.supplier_id || latest.supplierId || null }
      : null,
    previous: previous ? { value: String(previousValue), effectiveAt: at(previous) } : null,
    change,
    windows: {
      d7: windowSpend(rows, now, 7),
      d30: windowSpend(rows, now, 30),
      d90: windowSpend(rows, now, 90),
    },
    purchaseCount: rows.length,
    quantityPurchased: rows.reduce((sum, row) => sum + Number(row.canonical_quantity ?? row.canonicalQuantity ?? 0), 0) || null,
  };
}

function at(row) {
  return row.effective_at || row.effectiveAt || row.purchase_date || null;
}

function windowSpend(rows, now, days) {
  const start = now.getTime() - days * 24 * 60 * 60 * 1000;
  const slice = rows.filter((row) => new Date(at(row)).getTime() >= start);
  if (!slice.length) return { status: "UNKNOWN", count: 0, spend: null };
  const spend = slice.reduce((sum, row) => {
    const qty = Number(row.canonical_quantity ?? row.canonicalQuantity ?? 0);
    const cost = Number(row.canonical_unit_cost ?? row.canonicalUnitCost ?? 0);
    return sum + (qty * cost);
  }, 0);
  return { status: "OK", count: slice.length, spend: String(spend) };
}
