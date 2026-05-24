/**
 * Waiter identity merge for executive rankings — canonical names before totals.
 */

import { canonicalStaffName } from "../../config/staffRoles";
import { reviewConversionPct } from "../../../platform/engines/funnelAnalyticsEngine";

/**
 * Merge ranking rows by canonical waiter identity (sales, upsell, Google).
 * Preserves first-seen role; sums numeric metrics.
 */
export function mergeWaiterRankingRows(rows = [], options = {}) {
  const sumKeys = options.sumKeys || [
    "net_sales",
    "gross_sales",
    "quantity",
    "google_redirects",
    "qr_scans",
    "scans",
    "google",
    "generated",
    "copy",
  ];
  const nameKey = options.nameKey || "waiter";
  const audit = [];

  const map = new Map();

  (rows || []).forEach((row) => {
    const rawName = row[nameKey] || row.name || "Unassigned";
    const canonical = canonicalStaffName(rawName);
    const key = canonical.toLowerCase();

    if (rawName !== canonical) {
      audit.push({ raw: rawName, canonical });
    }

    if (!map.has(key)) {
      map.set(key, {
        ...row,
        [nameKey]: canonical,
        name: canonical,
        waiter: canonical,
        _raw_names: rawName !== canonical ? [rawName] : [],
      });
      return;
    }

    const agg = map.get(key);
    if (rawName !== canonical && !agg._raw_names.includes(rawName)) {
      agg._raw_names.push(rawName);
    }

    sumKeys.forEach((k) => {
      if (row[k] == null) return;
      agg[k] = (Number(agg[k]) || 0) + (Number(row[k]) || 0);
    });

    if (!agg.role && row.role) agg.role = row.role;
    if (!agg.roleLabel && row.roleLabel) agg.roleLabel = row.roleLabel;
  });

  const merged = [...map.values()].map((r) => {
    const out = { ...r };
    if (out.google != null && out.scans != null) {
      out.conversion_pct = reviewConversionPct(out.google, out.scans);
    }
    delete out._raw_names;
    return out;
  });

  return { rows: merged, audit };
}

/** Merge Khobar review funnel stats by canonical waiter name. */
export function mergeReviewWaiterStats(staffList = []) {
  const { rows, audit } = mergeWaiterRankingRows(
    (staffList || []).map((s) => ({
      ...s,
      waiter: s.name,
      name: s.name,
    })),
    { sumKeys: ["scans", "google", "generated", "copy", "review_opens"], nameKey: "name" },
  );

  return {
    staff: rows.map((s) => ({
      ...s,
      name: s.name,
      conversion_pct: reviewConversionPct(s.google, s.scans),
    })),
    audit,
  };
}
