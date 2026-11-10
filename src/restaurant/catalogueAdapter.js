/**
 * Read-only ordering view of the canonical menu.
 * Identities stay on the menu row. Foodics SKUs never merge a finished dish with an ingredient.
 * This module does not write Foodics, menu tables, or the guest menu.
 */
import { assertServiceBranch, catalogueLine } from "./contracts";

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nameKey(row) {
  return text(row.name_en || row.name || row.en).toLowerCase();
}

function priceNumber(value) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function orderingIdentity(row) {
  const itemId = row?.id || row?.itemId || null;
  if (!itemId) return { itemId: null, catalogueKey: null };
  const catalogueKey = row.cloned_from_id || row.placement_group_id || row.catalogueKey || itemId;
  return { itemId, catalogueKey: String(catalogueKey) };
}

function isIngredientRecord(row) {
  const kind = text(row?.kind || row?.recordType || row?.recipe_type).toLowerCase();
  return kind === "ingredient" || kind === "inventory" || kind === "subrecipe";
}

function hiddenNow(row, now) {
  if (row?.active === false) return "inactive";
  if (row?.sold_out === true || row?.soldOut === true) return "sold_out";
  const until = row?.hidden_until || row?.hiddenUntil;
  if (until && new Date(until).getTime() > now) return "hidden";
  return null;
}

function availabilityFor(row, branchId, records, now) {
  const identity = orderingIdentity(row);
  const specific = (records || []).find((record) => {
    const key = record.catalogueKey || record.itemId;
    return record.branchId === branchId && (key === identity.catalogueKey || key === identity.itemId);
  });
  if (specific) {
    if (specific.available === false || specific.soldOut === true) {
      return { available: false, reason: specific.reason || "unavailable" };
    }
    return { available: true, reason: null };
  }
  if ((row.branch_id || row.branchId) === branchId) {
    const reason = hiddenNow(row, now);
    return { available: !reason, reason };
  }
  return { available: false, reason: "availability_not_recorded" };
}

function groupRows(items) {
  const groups = new Map();
  items.forEach((row) => {
    if (isIngredientRecord(row)) return;
    const identity = orderingIdentity(row);
    const price = priceNumber(row.price);
    if (!identity.itemId || !nameKey(row) || price == null) return;
    const key = `${row.branch_id || row.branchId || ""}|${nameKey(row)}|${price}`;
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  });
  return [...groups.values()].map((rows) => rows.slice().sort((left, right) => (
    (left.sort_order ?? 0) - (right.sort_order ?? 0) || String(left.id).localeCompare(String(right.id))
  )));
}

export function buildOrderingCatalogue(snapshot, { branchId, availability = [], now = Date.now() } = {}) {
  const branch = assertServiceBranch(branchId);
  if (!branch.ok) return { ...branch, lines: [] };
  const addOns = new Map((snapshot?.addOns || []).filter((row) => row.active !== false).map((row) => [row.id, row]));
  const addonsByItem = new Map();
  (snapshot?.itemAddons || []).forEach((link) => {
    const list = addonsByItem.get(link.item_id) || [];
    list.push(link);
    addonsByItem.set(link.item_id, list);
  });
  const allergenNames = new Map((snapshot?.allergens || []).map((row) => [row.id, row.name_en || row.code || row.id]));
  const allergensByItem = new Map();
  (snapshot?.itemAllergens || []).forEach((link) => {
    const list = allergensByItem.get(link.item_id) || [];
    const name = allergenNames.get(link.allergen_id);
    if (name) list.push(name);
    allergensByItem.set(link.item_id, list);
  });
  const sections = new Map((snapshot?.sections || []).map((row) => [row.id, row]));
  const categories = new Map((snapshot?.categories || []).map((row) => [row.id, row]));
  const lines = [];
  groupRows(snapshot?.items || []).forEach((rows) => {
    const primary = rows[0];
    const identity = orderingIdentity(primary);
    const ids = new Set(rows.map((row) => row.id));
    const modifierLinks = [...ids].flatMap((id) => addonsByItem.get(id) || []);
    const seenModifiers = new Set();
    const modifiers = modifierLinks
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((link) => addOns.get(link.addon_id))
      .filter((addon) => {
        if (!addon || seenModifiers.has(addon.id)) return false;
        seenModifiers.add(addon.id);
        return true;
      })
      .map((addon) => ({ id: addon.id, name: addon.name_en || addon.name, price: addon.price }));
    const branchAvailability = availabilityFor(primary, branchId, availability, now);
    const priced = catalogueLine({
      itemId: identity.itemId,
      name: primary.name_en || primary.name,
      price: primary.price,
      branchId,
      available: branchAvailability.available,
      modifiers,
    });
    if (!priced.ok) return;
    const section = sections.get(primary.section_id);
    const category = categories.get(section?.category_id);
    const calories = priceNumber(primary.calories);
    const sameName = (snapshot?.items || []).filter((row) => nameKey(row) === nameKey(primary) && priceNumber(row.price) != null);
    const distinctPrices = new Set(sameName.map((row) => priceNumber(row.price)));
    lines.push({
      ...priced.line,
      catalogueKey: identity.catalogueKey,
      nameAr: primary.name_ar || "",
      calories: calories == null || primary.calories === "-" ? null : calories,
      allergens: [...new Set([...ids].flatMap((id) => allergensByItem.get(id) || []))],
      categoryId: category?.id || section?.category_id || null,
      categoryName: category?.name_en || "Menu",
      sectionName: section?.name_en || "",
      vegetarian: rows.some((row) => row.vegetarian === true),
      vegan: rows.some((row) => row.vegan === true),
      portionLabel: distinctPrices.size > 1 ? `${priced.line.price} SAR` : null,
      unavailableReason: branchAvailability.reason,
      instructionsAllowed: true,
      foodicsSku: null,
      writes: 0,
    });
  });

  return { ok: true, branchId, lines, writes: 0, guestChanged: false };
}

export function filterOrderingCatalogue(lines, { query = "", categoryId = "", availableOnly = false, dietary = "" } = {}) {
  const needle = text(query).toLowerCase();
  return (lines || []).filter((line) => {
    if (categoryId && line.categoryId !== categoryId) return false;
    if (availableOnly && line.available === false) return false;
    if (dietary === "vegetarian" && !line.vegetarian) return false;
    if (dietary === "vegan" && !line.vegan) return false;
    if (!needle) return true;
    const hay = [line.name, line.nameAr, line.categoryName, line.sectionName, ...(line.allergens || [])].join(" ").toLowerCase();
    return hay.includes(needle);
  });
}
