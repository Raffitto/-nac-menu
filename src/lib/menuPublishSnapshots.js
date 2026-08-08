import { filterPublicMenuData } from "./menuVisibility";

/**
 * Build a publication-shaped snapshot object from raw table rows.
 * Mirrors nac_menu_branch_snapshot shape (without requiring the revoked RPC).
 */
export function buildBranchSnapshotFromRows({
  branchId,
  categories = [],
  sections = [],
  menuItems = [],
  itemAddons = [],
  itemAllergens = [],
}) {
  return {
    branch_id: branchId,
    categories: categories || [],
    sections: sections || [],
    menu_items: menuItems || [],
    item_addons: itemAddons || [],
    item_allergens: itemAllergens || [],
  };
}

/**
 * Convert a publication snapshot into guest menuData shape for preview.
 * Add-on master rows are optional; recommended add-ons may be empty without them.
 */
export function snapshotToGuestMenu(snapshot, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const addonById = Object.fromEntries((options.addOns || []).map((a) => [a.id, a]));
  const allergenById = Object.fromEntries((options.allergens || []).map((a) => [a.id, a]));

  const categories = (snapshot?.categories || [])
    .filter((c) => c.active !== false)
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const sections = (snapshot?.sections || [])
    .filter((s) => s.active !== false)
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const items = (snapshot?.menu_items || [])
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const itemIds = new Set(items.map((it) => it.id));
  const itemAddonJunc = (snapshot?.item_addons || []).filter((j) => itemIds.has(j.item_id));
  const itemAllergenJunc = (snapshot?.item_allergens || []).filter((j) => itemIds.has(j.item_id));

  const addonsByItem = {};
  itemAddonJunc.forEach((j) => {
    const addon = addonById[j.addon_id];
    if (!addon) return;
    if (!addonsByItem[j.item_id]) addonsByItem[j.item_id] = [];
    addonsByItem[j.item_id].push(addon);
  });

  const allergensByItem = {};
  itemAllergenJunc.forEach((j) => {
    const allergen = allergenById[j.allergen_id];
    if (!allergen) return;
    if (!allergensByItem[j.item_id]) allergensByItem[j.item_id] = [];
    allergensByItem[j.item_id].push(allergen.code);
  });

  const sectionsByCat = {};
  sections.forEach((sec) => {
    if (!sectionsByCat[sec.category_id]) sectionsByCat[sec.category_id] = [];
    sectionsByCat[sec.category_id].push(sec);
  });

  const itemsBySec = {};
  items.forEach((it) => {
    if (!itemsBySec[it.section_id]) itemsBySec[it.section_id] = [];
    itemsBySec[it.section_id].push(it);
  });

  const menuData = {};
  categories.forEach((cat) => {
    const catSections = sectionsByCat[cat.id] || [];
    menuData[cat.slug] = catSections.map((sec) => ({
      title: { en: sec.name_en, ar: sec.name_ar },
      items: (itemsBySec[sec.id] || []).map((it) => ({
        id: it.id,
        en: it.name_en,
        ar: it.name_ar,
        descEn: it.desc_en || "",
        descAr: it.desc_ar || "",
        calories: it.calories || "-",
        price: it.price,
        image: it.image || "",
        soldOut: it.sold_out,
        active: it.active !== false,
        hiddenUntil: it.hidden_until || null,
        featured: Boolean(it.featured),
        newItem: Boolean(it.new_item),
        recommended: (addonsByItem[it.id] || []).map((addon) => ({
          en: addon.name_en,
          ar: addon.name_ar,
          price: addon.price,
          calories: addon.calories || "-",
          allergens: [],
          previewImage: addon.preview_image || "",
        })),
        allergens: allergensByItem[it.id] || [],
        tags: [
          it.vegetarian ? "vegetarian" : null,
          it.vegan ? "vegan" : null,
          it.new_item ? "new" : null,
        ].filter(Boolean),
      })),
    }));
  });

  const formattedCategories = categories.map((c) => ({
    id: c.slug,
    en: c.name_en,
    ar: c.name_ar,
    timeEn: c.time_en || "",
    timeAr: c.time_ar || "",
    icon: c.icon || "",
    iconAr: c.icon_ar || "",
  }));

  return {
    categories: formattedCategories,
    menuData: filterPublicMenuData(menuData, nowMs),
    addOns: options.addOnsBySlug || {},
    allergenLabels: options.allergenLabels || {},
  };
}

export function publicationListLabel(row) {
  if (!row) return "Unknown version";
  const when = row.guest_verified_at || row.published_at || row.created_at;
  const date = when
    ? new Date(when).toLocaleString("en-GB", {
        timeZone: "Asia/Riyadh",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Unknown time";
  return `Version ${row.version} · ${date}`;
}
