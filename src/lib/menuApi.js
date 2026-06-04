import { supabase } from "./supabase";
import { BREAKFAST_ICON_EN, BREAKFAST_ICON_AR } from "./menuPresentation";
import { filterPublicMenuData } from "./menuVisibility";
import { newPlacementGroupId } from "./menuPlacements";
import { normalizeBranchId } from "../dashboard/utils/branchIdentity";
import { menuBranchQueryFilter } from "./menuBranchScope";

export const MENU_CACHE_KEY = "nac-menu-cache";
const CACHE_TTL_MS = 60 * 1000;

// ═══════════════ HELPERS ═══════════════

function cached(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* quota exceeded — silently skip */
  }
}

export function invalidateMenuCache() {
  try {
    localStorage.removeItem(MENU_CACHE_KEY);
    localStorage.removeItem("nac_menu_cache");
  } catch {
    /* ignore */
  }
}

const MENU_ITEM_DB_FIELDS = new Set([
  "name_en",
  "name_ar",
  "desc_en",
  "desc_ar",
  "price",
  "calories",
  "image",
  "section_id",
  "slug",
  "sold_out",
  "featured",
  "new_item",
  "vegetarian",
  "vegan",
  "active",
  "hidden_until",
  "sort_order",
  "available_from",
  "available_until",
  "placement_group_id",
  "branch_id",
]);

/** Strip UI-only keys (e.g. category_id) before Supabase writes. */
export function sanitizeMenuItemPayload(raw = {}) {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (MENU_ITEM_DB_FIELDS.has(key) && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** CamelCase slug for add_ons (matches menu_seed.sql conventions). */
export function buildAddonSlug(nameEn) {
  const words = String(nameEn || "")
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  const [first, ...rest] = words;
  return (
    first.toLowerCase() +
    rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("")
  );
}

/** DB stores price as text e.g. "6 SAR". */
export function formatAddonPrice(raw) {
  if (raw == null || raw === "") return "-";
  const s = String(raw).trim();
  if (/sar/i.test(s)) return s;
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (Number.isFinite(n) && n >= 0) return `${n} SAR`;
  return s || "-";
}

export function sanitizeAddonPayload(raw = {}, { slug: slugOverride } = {}) {
  const name_en = String(raw.name_en || "").trim();
  const name_ar = String(raw.name_ar || "").trim() || name_en;
  const price = formatAddonPrice(raw.price);
  const payload = {
    name_en,
    name_ar,
    price,
    active: raw.active !== false,
  };
  if (slugOverride) payload.slug = slugOverride;
  if (raw.preview_image != null) payload.preview_image = raw.preview_image;
  if (raw.calories != null) payload.calories = raw.calories;
  return payload;
}

async function resolveUniqueAddonSlug(nameEn, excludeId = null) {
  let base = buildAddonSlug(nameEn);
  if (!base) base = `addon${Date.now()}`;
  let slug = base;
  let n = 2;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { data, error } = await supabase
      .from("add_ons")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!data || (excludeId && data.id === excludeId)) return slug;
    slug = `${base}${n}`;
    n += 1;
  }
  throw new Error("Could not generate a unique add-on slug");
}

export function logMenuMutation(label, payload, response) {
  if (process.env.NODE_ENV !== "production" || process.env.REACT_APP_MENU_DEBUG === "1") {
    // eslint-disable-next-line no-console
    console.info(`[menu] ${label}`, { payload, response });
  }
}

export function assertMenuMutation(result, label) {
  if (result?.error) {
    logMenuMutation(`${label} FAILED`, null, result.error);
    const msg = result.error.message || `Menu operation failed: ${label}`;
    if (/row-level security/i.test(msg)) {
      throw new Error(
        `${msg} — sign in with a Supabase staff account (Settings → Supabase access) before editing the menu.`,
      );
    }
    throw new Error(msg);
  }
  logMenuMutation(`${label} OK`, null, result?.data ?? result);
  return result?.data ?? result;
}

/** Admin CRUD requires authenticated JWT (not anon). */
export async function requireMenuEditorAuth() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) {
    throw new Error(
      "Sign in with your Supabase staff account to edit the menu (Settings → Supabase access).",
    );
  }
  return session;
}

export async function fetchMenuItemById(id) {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("id", id)
    .single();
  return { data, error };
}

async function compressImage(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => resolve(blob || file),
        "image/jpeg",
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

function buildTags(item) {
  const tags = [];
  if (item.vegan) tags.push("vegan");
  else if (item.vegetarian) tags.push("vegetarian");
  return tags;
}

// ═══════════════ PUBLIC READ (for guest menu) ═══════════════

export async function getCategories(options = {}) {
  const branchId = normalizeBranchId(options.branchId);
  let query = supabase
    .from("categories")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (branchId) query = menuBranchQueryFilter(query, branchId);

  const { data, error } = await query;
  return { data, error };
}

export async function getFullMenu(options = {}) {
  const bypassCache = options.bypassCache === true;
  const branchId = normalizeBranchId(options.branchId);
  const cacheKey = branchId ? `${MENU_CACHE_KEY}:${branchId}` : MENU_CACHE_KEY;
  if (!bypassCache) {
    const hit = cached(cacheKey);
    if (hit) return { data: hit, error: null };
  }

  let catQuery = supabase.from("categories").select("*").eq("active", true).order("sort_order");
  let secQuery = supabase.from("sections").select("*").eq("active", true).order("sort_order");
  let itemQuery = supabase.from("menu_items").select("*").order("sort_order");
  if (branchId) {
    catQuery = menuBranchQueryFilter(catQuery, branchId);
    secQuery = menuBranchQueryFilter(secQuery, branchId);
    itemQuery = menuBranchQueryFilter(itemQuery, branchId);
  }

  const [catRes, secRes, itemRes, addonRes, juncAddonRes, allergenRes, juncAllergenRes] =
    await Promise.all([
      catQuery,
      secQuery,
      itemQuery,
      supabase.from("add_ons").select("*").eq("active", true),
      supabase.from("item_addons").select("*").order("sort_order"),
      supabase.from("allergens").select("*"),
      supabase.from("item_allergens").select("*"),
    ]);

  const firstError =
    catRes.error ||
    secRes.error ||
    itemRes.error ||
    addonRes.error ||
    juncAddonRes.error ||
    allergenRes.error ||
    juncAllergenRes.error;
  if (firstError) return { data: null, error: firstError };

  const categories = catRes.data;
  const sections = secRes.data;
  const items = itemRes.data;
  const itemIds = new Set((items || []).map((it) => it.id));
  const addons = addonRes.data;
  const itemAddonJunc = (juncAddonRes.data || []).filter((j) => itemIds.has(j.item_id));
  const allergens = allergenRes.data;
  const itemAllergenJunc = (juncAllergenRes.data || []).filter((j) => itemIds.has(j.item_id));

  const addonById = Object.fromEntries(addons.map((a) => [a.id, a]));
  const allergenById = Object.fromEntries(allergens.map((a) => [a.id, a]));

  const addonsByItem = {};
  for (const j of itemAddonJunc) {
    if (!addonsByItem[j.item_id]) addonsByItem[j.item_id] = [];
    const addon = addonById[j.addon_id];
    if (addon) addonsByItem[j.item_id].push(addon);
  }

  const allergensByItem = {};
  for (const j of itemAllergenJunc) {
    if (!allergensByItem[j.item_id]) allergensByItem[j.item_id] = [];
    const allergen = allergenById[j.allergen_id];
    if (allergen) allergensByItem[j.item_id].push(allergen.code);
  }

  const sectionsByCat = {};
  for (const sec of sections) {
    if (!sectionsByCat[sec.category_id]) sectionsByCat[sec.category_id] = [];
    sectionsByCat[sec.category_id].push(sec);
  }

  const itemsBySec = {};
  for (const it of items) {
    if (!itemsBySec[it.section_id]) itemsBySec[it.section_id] = [];
    itemsBySec[it.section_id].push(it);
  }

  const menuData = {};
  for (const cat of categories) {
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
        recommended: (addonsByItem[it.id] || []).map((addon) => ({
          en: addon.name_en,
          ar: addon.name_ar,
          price: addon.price,
          calories: addon.calories || "-",
          allergens: [],
          previewImage: addon.preview_image || "",
        })),
        allergens: allergensByItem[it.id] || [],
        tags: buildTags(it),
      })),
    }));
  }

  const addOns = {};
  for (const a of addons) {
    addOns[a.slug] = {
      en: a.name_en,
      ar: a.name_ar,
      price: a.price,
      calories: a.calories || "-",
      allergens: [],
      previewImage: a.preview_image || "",
    };
  }

  const allergenLabels = {};
  for (const a of allergens) {
    allergenLabels[a.code] = { en: a.name_en, ar: a.name_ar };
  }

  const formattedCategories = categories.map((c) => ({
    id: c.slug,
    en: c.name_en,
    ar: c.name_ar,
    timeEn: c.time_en || "",
    timeAr: c.time_ar || "",
    icon: c.slug === "breakfast" ? BREAKFAST_ICON_EN : c.icon || "",
    iconAr: c.slug === "breakfast" ? BREAKFAST_ICON_AR : c.icon_ar || "",
  }));

  const result = {
    categories: formattedCategories,
    menuData: filterPublicMenuData(menuData),
    addOns,
    allergenLabels,
  };

  setCache(cacheKey, result);
  return { data: result, error: null };
}

export async function getMenuByCategory(categorySlug) {
  const { data: cat, error: catErr } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", categorySlug)
    .eq("active", true)
    .single();

  if (catErr || !cat) return { data: null, error: catErr || new Error("Category not found") };

  const { data: sections, error: secErr } = await supabase
    .from("sections")
    .select("*")
    .eq("category_id", cat.id)
    .eq("active", true)
    .order("sort_order");

  if (secErr) return { data: null, error: secErr };

  const sectionIds = sections.map((s) => s.id);
  if (sectionIds.length === 0) return { data: [], error: null };

  const [itemRes] = await Promise.all([
    supabase
      .from("menu_items")
      .select("*")
      .in("section_id", sectionIds)
      .order("sort_order"),
  ]);

  if (itemRes.error) return { data: null, error: itemRes.error };

  const allItemIds = itemRes.data.map((i) => i.id);
  const [juncAddonRes, juncAllergenRes] = await Promise.all([
    allItemIds.length > 0
      ? supabase.from("item_addons").select("*, add_ons(*)").in("item_id", allItemIds).order("sort_order")
      : { data: [], error: null },
    allItemIds.length > 0
      ? supabase.from("item_allergens").select("*, allergens(code)").in("item_id", allItemIds)
      : { data: [], error: null },
  ]);

  if (juncAddonRes.error) return { data: null, error: juncAddonRes.error };
  if (juncAllergenRes.error) return { data: null, error: juncAllergenRes.error };

  const addonsByItem = {};
  for (const j of juncAddonRes.data) {
    if (!addonsByItem[j.item_id]) addonsByItem[j.item_id] = [];
    if (j.add_ons) addonsByItem[j.item_id].push(j.add_ons);
  }

  const allergensByItem = {};
  for (const j of juncAllergenRes.data) {
    if (!allergensByItem[j.item_id]) allergensByItem[j.item_id] = [];
    if (j.allergens) allergensByItem[j.item_id].push(j.allergens.code);
  }

  const itemsBySec = {};
  for (const it of itemRes.data) {
    if (!itemsBySec[it.section_id]) itemsBySec[it.section_id] = [];
    itemsBySec[it.section_id].push(it);
  }

  const result = sections.map((sec) => ({
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
      recommended: (addonsByItem[it.id] || []).map((addon) => ({
        en: addon.name_en,
        ar: addon.name_ar,
        price: addon.price,
        calories: addon.calories || "-",
        allergens: [],
        previewImage: addon.preview_image || "",
      })),
      allergens: allergensByItem[it.id] || [],
      tags: buildTags(it),
    })),
  }));

  const visible = filterPublicMenuData({ [categorySlug]: result })[categorySlug] || [];
  return { data: visible, error: null };
}

// ═══════════════ VISIBILITY (Menu Manager) ═══════════════

/** Permanently hide from guest menu. */
export async function hideMenuItemPermanently(id) {
  return updateMenuItem(id, { active: false, hidden_until: null });
}

/** Show on guest menu and clear any scheduled hide. */
export async function restoreMenuItemVisibility(id) {
  return updateMenuItem(id, { active: true, hidden_until: null });
}

/** Timed hide — keeps active=true so the item auto-reappears after hidden_until. */
export async function scheduleMenuItemHide(id, hiddenUntilIso) {
  if (!hiddenUntilIso) {
    return { data: null, error: new Error("hidden_until is required") };
  }
  return updateMenuItem(id, { active: true, hidden_until: hiddenUntilIso });
}

// ═══════════════ ADMIN CRUD (authenticated) ═══════════════

export async function updateMenuItem(id, updates) {
  await requireMenuEditorAuth();
  const payload = sanitizeMenuItemPayload(updates);
  logMenuMutation("updateMenuItem request", { id, payload }, null);
  const { data, error } = await supabase
    .from("menu_items")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  logMenuMutation("updateMenuItem response", { id, payload }, { data, error });
  if (!error) invalidateMenuCache();
  return { data, error };
}

export async function createMenuItem(item, allergenCodes = [], addonSlugs = []) {
  await requireMenuEditorAuth();
  const payload = sanitizeMenuItemPayload(item);
  logMenuMutation("createMenuItem request", payload, null);
  const { data: newItem, error } = await supabase
    .from("menu_items")
    .insert(payload)
    .select()
    .single();
  logMenuMutation("createMenuItem response", payload, { data: newItem, error });

  if (error) return { data: null, error };

  const itemId = newItem.id;

  if (allergenCodes.length > 0) {
    const { data: matchedAllergens } = await supabase
      .from("allergens")
      .select("id")
      .in("code", allergenCodes);

    if (matchedAllergens?.length) {
      const rows = matchedAllergens.map((a) => ({
        item_id: itemId,
        allergen_id: a.id,
      }));
      await supabase.from("item_allergens").insert(rows);
    }
  }

  if (addonSlugs.length > 0) {
    const { data: matchedAddons } = await supabase
      .from("add_ons")
      .select("id")
      .in("slug", addonSlugs);

    if (matchedAddons?.length) {
      const rows = matchedAddons.map((a, i) => ({
        item_id: itemId,
        addon_id: a.id,
        sort_order: i,
      }));
      await supabase.from("item_addons").insert(rows);
    }
  }

  invalidateMenuCache();
  return { data: newItem, error: null };
}

async function insertMenuItemRow(payload) {
  const row = sanitizeMenuItemPayload(payload);
  const { data, error } = await supabase.from("menu_items").insert(row).select().single();
  return { data, error };
}

/** Copy allergen + add-on junction rows from one item to another. */
export async function copyItemRelations(sourceItemId, targetItemId) {
  const [addonJunc, allergenJunc] = await Promise.all([
    supabase.from("item_addons").select("addon_id, sort_order").eq("item_id", sourceItemId),
    supabase.from("item_allergens").select("allergen_id").eq("item_id", sourceItemId),
  ]);

  if (addonJunc.data?.length) {
    await supabase.from("item_addons").insert(
      addonJunc.data.map((r) => ({
        item_id: targetItemId,
        addon_id: r.addon_id,
        sort_order: r.sort_order,
      })),
    );
  }

  if (allergenJunc.data?.length) {
    await supabase.from("item_allergens").insert(
      allergenJunc.data.map((r) => ({
        item_id: targetItemId,
        allergen_id: r.allergen_id,
      })),
    );
  }
}

export async function fetchPlacementGroupMembers(placementGroupId) {
  if (!placementGroupId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, section_id, placement_group_id, name_en")
    .eq("placement_group_id", placementGroupId)
    .order("created_at");
  return { data: data || [], error };
}

/** All rows in given placement groups (for admin badges). */
export async function fetchPlacementGroupIndex(groupIds) {
  const ids = [...new Set((groupIds || []).filter(Boolean))];
  if (!ids.length) return { data: [], error: null };
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, section_id, placement_group_id")
    .in("placement_group_id", ids);
  return { data: data || [], error };
}

/**
 * Create primary item + clone rows for extra section placements (same content & group).
 */
export async function createMenuItemPlacements({
  contentPayload,
  primarySectionId,
  extraSectionIds = [],
  allergenIds = [],
  addonIds = [],
}) {
  await requireMenuEditorAuth();
  const placementGroupId = newPlacementGroupId();
  const sectionIds = [
    primarySectionId,
    ...extraSectionIds.filter((id) => id && id !== primarySectionId),
  ];
  const uniqueSectionIds = [...new Set(sectionIds.filter(Boolean))];
  if (!uniqueSectionIds.length) {
    return { data: null, error: new Error("Primary section is required"), created: [] };
  }

  const created = [];
  for (const sectionId of uniqueSectionIds) {
    const { data, error } = await insertMenuItemRow({
      ...contentPayload,
      section_id: sectionId,
      placement_group_id: placementGroupId,
    });
    if (error) return { data: null, error, created };
    created.push(data);
  }

  const primary = created[0];
  if (allergenIds.length) await setItemAllergens(primary.id, allergenIds);
  if (addonIds.length) await setItemAddons(primary.id, addonIds);

  for (let i = 1; i < created.length; i += 1) {
    await copyItemRelations(primary.id, created[i].id);
  }

  invalidateMenuCache();
  return { data: primary, created, placementGroupId, error: null };
}

/**
 * Update item; optionally sync content to all rows in placement_group_id.
 * Manages extra placement clones and removals.
 */
export async function updateMenuItemPlacements({
  itemId,
  contentPayload,
  primarySectionId,
  extraPlacements = [],
  removePlacementItemIds = [],
  syncLinked = false,
  placementGroupId = null,
  allergenIds = [],
  addonIds = [],
}) {
  await requireMenuEditorAuth();

  const contentOnly = sanitizeMenuItemPayload(contentPayload);
  const removed = new Set(removePlacementItemIds.filter((id) => id && id !== itemId));

  for (const id of removed) {
    await deleteMenuItem(id);
  }

  let groupId = placementGroupId || null;
  const needsGroup =
    extraPlacements.length > 0 || removed.size > 0 || Boolean(groupId);
  if (needsGroup && !groupId) {
    groupId = newPlacementGroupId();
    await updateMenuItem(itemId, { placement_group_id: groupId });
  }

  let members = [];
  if (groupId) {
    const { data } = await fetchPlacementGroupMembers(groupId);
    members = (data || []).filter((m) => !removed.has(m.id));
    if (!members.some((m) => m.id === itemId)) {
      members.push({ id: itemId, section_id: primarySectionId });
    }
  } else {
    members = [{ id: itemId, section_id: primarySectionId }];
  }

  const applyRelations = async (ids) => {
    await Promise.all(ids.map((id) => setItemAllergens(id, allergenIds).catch(() => {})));
    await Promise.all(ids.map((id) => setItemAddons(id, addonIds).catch(() => {})));
  };

  if (syncLinked && groupId) {
    await Promise.all(
      members.map((m) =>
        updateMenuItem(m.id, {
          ...contentOnly,
          placement_group_id: groupId,
          ...(m.id === itemId ? { section_id: primarySectionId } : {}),
        }),
      ),
    );
    await applyRelations(members.map((m) => m.id));
  } else {
    await updateMenuItem(itemId, {
      ...contentOnly,
      section_id: primarySectionId,
      placement_group_id: groupId,
    });
    await applyRelations([itemId]);
  }

  for (const placement of extraPlacements) {
    if (!placement.sectionId) continue;
    if (placement.itemId) {
      if (!syncLinked || placement.itemId !== itemId) {
        await updateMenuItem(placement.itemId, {
          section_id: placement.sectionId,
          placement_group_id: groupId,
        });
      }
      continue;
    }
    const { data: created, error } = await insertMenuItemRow({
      ...contentOnly,
      section_id: placement.sectionId,
      placement_group_id: groupId,
    });
    if (error) throw error;
    if (syncLinked) {
      await setItemAllergens(created.id, allergenIds).catch(() => {});
      await setItemAddons(created.id, addonIds).catch(() => {});
    } else {
      await copyItemRelations(itemId, created.id);
    }
  }

  invalidateMenuCache();
  const { data: primary } = await fetchMenuItemById(itemId);
  return { data: primary, error: null };
}

export async function deleteMenuItem(id) {
  await requireMenuEditorAuth();
  const { data, error } = await supabase
    .from("menu_items")
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data, error };
}

export async function toggleSoldOut(id, soldOut) {
  const result = await updateMenuItem(id, { sold_out: Boolean(soldOut) });
  return result;
}

/** Apply visibility + sold-out in one persisted write. */
export async function applyMenuItemVisibility(id, { active, hidden_until, sold_out }) {
  const patch = sanitizeMenuItemPayload({
    active,
    hidden_until: hidden_until ?? null,
    ...(sold_out !== undefined ? { sold_out: Boolean(sold_out) } : {}),
  });
  return updateMenuItem(id, patch);
}

export async function toggleItemActive(id, active) {
  if (active) {
    return restoreMenuItemVisibility(id);
  }
  return hideMenuItemPermanently(id);
}

export async function reorderSections(updates) {
  await requireMenuEditorAuth();
  const results = await Promise.all(
    updates.map(({ id, sort_order }) =>
      supabase.from("sections").update({ sort_order }).eq("id", id),
    ),
  );

  const error = results.find((r) => r.error)?.error || null;
  if (!error) invalidateMenuCache();
  return { data: !error, error };
}

export async function reorderItems(updates) {
  await requireMenuEditorAuth();
  const results = await Promise.all(
    updates.map(({ id, sort_order }) =>
      supabase.from("menu_items").update({ sort_order }).eq("id", id),
    ),
  );

  const error = results.find((r) => r.error)?.error || null;
  if (!error) invalidateMenuCache();
  return { data: !error, error };
}

// ═══════════════ CATEGORY CRUD ═══════════════

export async function createCategory(data) {
  await requireMenuEditorAuth();
  const { data: cat, error } = await supabase
    .from("categories")
    .insert(data)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data: cat, error };
}

export async function updateCategory(id, updates) {
  await requireMenuEditorAuth();
  const { data, error } = await supabase
    .from("categories")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data, error };
}

export async function deleteCategory(id) {
  await requireMenuEditorAuth();
  const { data, error } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data, error };
}

export async function reorderCategories(updates) {
  await requireMenuEditorAuth();
  const results = await Promise.all(
    updates.map(({ id, sort_order }) =>
      supabase.from("categories").update({ sort_order }).eq("id", id),
    ),
  );

  const error = results.find((r) => r.error)?.error || null;
  if (!error) invalidateMenuCache();
  return { data: !error, error };
}

// ═══════════════ SECTION CRUD ═══════════════

export async function createSection(data) {
  await requireMenuEditorAuth();
  const { data: sec, error } = await supabase
    .from("sections")
    .insert(data)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data: sec, error };
}

export async function updateSection(id, updates) {
  await requireMenuEditorAuth();
  const { data, error } = await supabase
    .from("sections")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data, error };
}

export async function deleteSection(id) {
  await requireMenuEditorAuth();
  const { data, error } = await supabase
    .from("sections")
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data, error };
}

// ═══════════════ ADD-ON CRUD ═══════════════

export async function getAddOns({ includeInactive = false } = {}) {
  let q = supabase.from("add_ons").select("*").order("slug");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  return { data, error };
}

export async function createAddOn(data) {
  await requireMenuEditorAuth();
  const slug = await resolveUniqueAddonSlug(data?.name_en);
  const payload = sanitizeAddonPayload(data, { slug });
  const result = await supabase.from("add_ons").insert(payload).select().single();
  if (!result.error) invalidateMenuCache();
  return result;
}

export async function updateAddOn(id, updates) {
  await requireMenuEditorAuth();
  const payload = sanitizeAddonPayload(updates);
  delete payload.slug;
  const result = await supabase.from("add_ons").update(payload).eq("id", id).select().single();
  if (!result.error) invalidateMenuCache();
  return result;
}

export async function deleteAddOn(id) {
  await requireMenuEditorAuth();
  const result = await supabase.from("add_ons").delete().eq("id", id).select().single();
  if (!result.error) invalidateMenuCache();
  return result;
}

/** Link an add-on slug to menu items matched by English name (admin seed/helper). */
export async function linkAddonToItemsByName(namePattern, addonSlug) {
  await requireMenuEditorAuth();
  const { data: addon, error: addonErr } = await supabase
    .from("add_ons")
    .select("id")
    .eq("slug", addonSlug)
    .maybeSingle();
  if (addonErr) return { data: null, error: addonErr };
  if (!addon) return { data: null, error: new Error(`Add-on not found: ${addonSlug}`) };

  const { data: items, error: itemsErr } = await supabase
    .from("menu_items")
    .select("id")
    .ilike("name_en", namePattern);
  if (itemsErr) return { data: null, error: itemsErr };
  if (!items?.length) return { data: [], error: null };

  const rows = [];
  for (const item of items) {
    const { data: existing } = await supabase
      .from("item_addons")
      .select("sort_order")
      .eq("item_id", item.id)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextOrder = existing?.length ? (Number(existing[0].sort_order) || 0) + 1 : 0;
    rows.push({ item_id: item.id, addon_id: addon.id, sort_order: nextOrder });
  }

  const { data, error } = await supabase.from("item_addons").upsert(rows, {
    onConflict: "item_id,addon_id",
    ignoreDuplicates: true,
  });
  if (!error) invalidateMenuCache();
  return { data, error };
}

// ═══════════════ ALLERGEN READ ═══════════════

export async function getAllergens() {
  const { data, error } = await supabase
    .from("allergens")
    .select("*")
    .order("code");

  return { data, error };
}

// ═══════════════ ITEM ADDON/ALLERGEN MANAGEMENT ═══════════════

export async function setItemAddons(itemId, addonIds) {
  await requireMenuEditorAuth();
  const { error: delErr } = await supabase
    .from("item_addons")
    .delete()
    .eq("item_id", itemId);

  if (delErr) return { data: null, error: delErr };

  if (addonIds.length === 0) return { data: [], error: null };

  const rows = addonIds.map((addonId, i) => ({
    item_id: itemId,
    addon_id: addonId,
    sort_order: i,
  }));

  const { data, error } = await supabase
    .from("item_addons")
    .insert(rows)
    .select();

  if (!error) invalidateMenuCache();
  return { data, error };
}

export async function setItemAllergens(itemId, allergenIds) {
  await requireMenuEditorAuth();
  const { error: delErr } = await supabase
    .from("item_allergens")
    .delete()
    .eq("item_id", itemId);

  if (delErr) return { data: null, error: delErr };

  if (allergenIds.length === 0) return { data: [], error: null };

  const rows = allergenIds.map((allergenId) => ({
    item_id: itemId,
    allergen_id: allergenId,
  }));

  const { data, error } = await supabase
    .from("item_allergens")
    .insert(rows)
    .select();

  if (!error) invalidateMenuCache();
  return { data, error };
}

// ═══════════════ IMAGE MANAGEMENT ═══════════════

const IMAGE_BUCKET = "menu-images";
const COMPRESS_THRESHOLD = 500 * 1024;

export async function uploadMenuImage(file, path) {
  await requireMenuEditorAuth();
  let upload = file;
  if (file.size > COMPRESS_THRESHOLD && file.type.startsWith("image/")) {
    upload = await compressImage(file);
  }

  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, upload, {
      cacheControl: "3600",
      upsert: true,
      contentType: upload.type || "image/jpeg",
    });

  if (error) return { data: null, error };

  const publicUrl = getImageUrl(data.path);
  return { data: { path: data.path, publicUrl }, error: null };
}

export async function deleteMenuImage(path) {
  await requireMenuEditorAuth();
  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .remove([path]);

  return { data, error };
}

export function getImageUrl(path) {
  const {
    data: { publicUrl },
  } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return publicUrl;
}

// ═══════════════ BULK OPERATIONS ═══════════════

export async function duplicateMenuItem(id) {
  await requireMenuEditorAuth();
  const { data: original, error: fetchErr } = await supabase
    .from("menu_items")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !original) return { data: null, error: fetchErr || new Error("Item not found") };

  const { id: _id, created_at: _ca, slug: _slug, placement_group_id: _pg, ...rest } = original;
  const clone = {
    ...rest,
    name_en: `${rest.name_en} (Copy)`,
    name_ar: `${rest.name_ar} (نسخة)`,
    sort_order: (rest.sort_order || 0) + 1,
    placement_group_id: null,
  };

  const { data: newItem, error: insertErr } = await supabase
    .from("menu_items")
    .insert(clone)
    .select()
    .single();

  if (insertErr) return { data: null, error: insertErr };

  const [addonJunc, allergenJunc] = await Promise.all([
    supabase.from("item_addons").select("addon_id, sort_order").eq("item_id", id),
    supabase.from("item_allergens").select("allergen_id").eq("item_id", id),
  ]);

  if (addonJunc.data?.length) {
    await supabase.from("item_addons").insert(
      addonJunc.data.map((r) => ({
        item_id: newItem.id,
        addon_id: r.addon_id,
        sort_order: r.sort_order,
      })),
    );
  }

  if (allergenJunc.data?.length) {
    await supabase.from("item_allergens").insert(
      allergenJunc.data.map((r) => ({
        item_id: newItem.id,
        allergen_id: r.allergen_id,
      })),
    );
  }

  invalidateMenuCache();
  return { data: newItem, error: null };
}

export async function bulkPriceUpdate(itemIds, percentageIncrease) {
  await requireMenuEditorAuth();
  const { data: items, error: fetchErr } = await supabase
    .from("menu_items")
    .select("id, price")
    .in("id", itemIds);

  if (fetchErr) return { data: null, error: fetchErr };

  const multiplier = 1 + percentageIncrease / 100;

  const results = await Promise.all(
    items.map((item) => {
      const numMatch = item.price.match(/([\d.]+)/);
      if (!numMatch) return { data: item, error: null };

      const oldNum = parseFloat(numMatch[1]);
      const newNum = Math.round(oldNum * multiplier);
      const newPrice = item.price.replace(numMatch[1], String(newNum));

      return supabase
        .from("menu_items")
        .update({ price: newPrice })
        .eq("id", item.id)
        .select()
        .single();
    }),
  );

  const error = results.find((r) => r.error)?.error || null;
  const data = results.map((r) => r.data).filter(Boolean);

  if (!error) invalidateMenuCache();
  return { data, error };
}
