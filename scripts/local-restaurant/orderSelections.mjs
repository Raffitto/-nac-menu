/** Canonical "2 Eggs Any Style" preparation. Price does not change. Matches src/lib/eggPreparation.js. */

export const EGG_PREPARATIONS = Object.freeze([
  { id: "fried", name: "Fried" },
  { id: "scrambled", name: "Scrambled" },
  { id: "poached", name: "Poached" },
]);

function amount(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function requiresEggPreparation(item) {
  if (!item) return false;
  const name = String(item.name_en || item.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (name !== "2 eggs any style") return false;
  if (amount(item.price) !== 31) return false;
  const calories = amount(item.calories);
  return calories != null && Math.abs(calories - 461.4) < 0.05;
}

export function validateOrderLine({ item, preparationId, modifierIds, allowedAddonIds, addonById, branchId }) {
  if (!item || item.active === false || item.sold_out === true) return { ok: false, reason: "item_unavailable" };
  if (item.branch_id && branchId && item.branch_id !== branchId) return { ok: false, reason: "item_not_in_menu" };
  const ids = (modifierIds || []).map(String);
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "modifier_duplicate" };
  let preparation = null;
  if (requiresEggPreparation(item)) {
    preparation = EGG_PREPARATIONS.find((row) => row.id === preparationId) || null;
    if (!preparation) return { ok: false, reason: "preparation_required" };
  } else if (preparationId) {
    return { ok: false, reason: "preparation_not_available" };
  }
  for (const id of ids) {
    if (!allowedAddonIds.has(id)) return { ok: false, reason: "modifier_not_available" };
    const addon = addonById.get(id);
    if (!addon || addon.active === false) return { ok: false, reason: "modifier_not_available" };
  }
  return { ok: true, preparation, modifierIds: ids };
}
