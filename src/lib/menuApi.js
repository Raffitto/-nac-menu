import { supabase } from "./supabase";

const MENU_CACHE_KEY = "nac-menu-cache";
const CACHE_TTL_MS = 5 * 60 * 1000;

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
  localStorage.removeItem(MENU_CACHE_KEY);
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

export async function getCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  return { data, error };
}

export async function getFullMenu() {
  const hit = cached(MENU_CACHE_KEY);
  if (hit) return { data: hit, error: null };

  const [catRes, secRes, itemRes, addonRes, juncAddonRes, allergenRes, juncAllergenRes] =
    await Promise.all([
      supabase
        .from("categories")
        .select("*")
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("sections")
        .select("*")
        .eq("active", true)
        .order("sort_order"),
      supabase
        .from("menu_items")
        .select("*")
        .eq("active", true)
        .order("sort_order"),
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
  const addons = addonRes.data;
  const itemAddonJunc = juncAddonRes.data;
  const allergens = allergenRes.data;
  const itemAllergenJunc = juncAllergenRes.data;

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
    icon: c.icon || "",
    iconAr: c.icon_ar || "",
  }));

  const result = {
    categories: formattedCategories,
    menuData,
    addOns,
    allergenLabels,
  };

  setCache(MENU_CACHE_KEY, result);
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
      .eq("active", true)
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

  return { data: result, error: null };
}

// ═══════════════ ADMIN CRUD (authenticated) ═══════════════

export async function updateMenuItem(id, updates) {
  const { data, error } = await supabase
    .from("menu_items")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data, error };
}

export async function createMenuItem(item, allergenCodes = [], addonSlugs = []) {
  const { data: newItem, error } = await supabase
    .from("menu_items")
    .insert(item)
    .select()
    .single();

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

export async function deleteMenuItem(id) {
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
  return updateMenuItem(id, { sold_out: soldOut });
}

export async function toggleItemActive(id, active) {
  return updateMenuItem(id, { active });
}

export async function reorderSections(updates) {
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
  const { data: cat, error } = await supabase
    .from("categories")
    .insert(data)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data: cat, error };
}

export async function updateCategory(id, updates) {
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
  const { data: sec, error } = await supabase
    .from("sections")
    .insert(data)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data: sec, error };
}

export async function updateSection(id, updates) {
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

export async function getAddOns() {
  const { data, error } = await supabase
    .from("add_ons")
    .select("*")
    .eq("active", true)
    .order("slug");

  return { data, error };
}

export async function createAddOn(data) {
  const { data: addon, error } = await supabase
    .from("add_ons")
    .insert(data)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data: addon, error };
}

export async function updateAddOn(id, updates) {
  const { data, error } = await supabase
    .from("add_ons")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (!error) invalidateMenuCache();
  return { data, error };
}

export async function deleteAddOn(id) {
  const { data, error } = await supabase
    .from("add_ons")
    .delete()
    .eq("id", id)
    .select()
    .single();

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
  const { data: original, error: fetchErr } = await supabase
    .from("menu_items")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !original) return { data: null, error: fetchErr || new Error("Item not found") };

  const { id: _id, created_at: _ca, slug: _slug, ...rest } = original;
  const clone = {
    ...rest,
    name_en: `${rest.name_en} (Copy)`,
    name_ar: `${rest.name_ar} (نسخة)`,
    sort_order: (rest.sort_order || 0) + 1,
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
