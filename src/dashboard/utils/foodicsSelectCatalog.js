import { normalizeFoodicsName } from "./foodicsNameNormalize";

const KIND_LABEL = {
  item: "Menu Item",
  addon: "Add-on",
};

/**
 * Unique NAC catalog options for manual mapping dropdowns.
 * Key = normalized(name) + kind — duplicate DB rows with same label collapse to one option.
 */
export function buildFoodicsSelectCatalog(menuItems = [], addOns = []) {
  const byKey = new Map();

  const add = (entry, kind) => {
    const nameEn = String(entry?.name_en || "").trim();
    if (!nameEn) return;
    const norm = normalizeFoodicsName(nameEn);
    const key = `${norm}::${kind}`;
    if (byKey.has(key)) return;
    byKey.set(key, {
      key,
      value: nameEn,
      name_en: nameEn,
      id: entry.id != null ? String(entry.id) : null,
      kind,
      label: `${nameEn} — ${KIND_LABEL[kind] || kind}`,
      norm,
    });
  };

  for (const mi of menuItems) add(mi, "item");
  for (const a of addOns) add(a, "addon");

  const options = Array.from(byKey.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );

  return { options, byKey };
}

/** Resolve selected option value (name_en) to catalog entry */
export function findCatalogOption(catalog, nameEn) {
  if (!catalog?.options) return null;
  return catalog.options.find((o) => o.name_en === nameEn) || null;
}
