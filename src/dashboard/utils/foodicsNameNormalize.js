/**
 * Canonical Foodics / menu name normalization for matching and deduplication.
 */

export function normalizeFoodicsName(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/sar/gi, "")
    .replace(/[^\w\s\u0600-\u06FF&,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable key for grouping duplicate Foodics rows */
export function foodicsDedupeKey(name) {
  return normalizeFoodicsName(name);
}
