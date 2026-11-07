import { resolveConfirmedMenuIdentity, isKnownMenuPlacementId } from "./menuIdentity";

/**
 * Preparation choice for the canonical "2 Eggs Any Style" product.
 * Price does not change.
 *
 * menu_items.id is a per-row UUID and this dish is placed more than once,
 * so those ids differ by section and by environment. menu_items.slug exists
 * but menu_seed does not set one. Identity is the official catalogue
 * signature is retained only for unbound legacy/fallback environments.
 * Confirmed placement UUIDs take precedence over editable presentation fields.
 */

export const EGG_ITEM_NAME_EN = "2 Eggs Any Style";
export const DEFAULT_EGG_PREPARATION_ID = "scrambled";
export const EGG_PREPARATION_GROUP_ID = "egg_preparation";
export const EGG_PRICE_SAR = 31;
export const EGG_CALORIES = 461.4;

export const EGG_PREPARATIONS = Object.freeze([
  { id: "fried", en: "Fried", ar: "مقلي", image: "/eggs-fried-menu.webp" },
  { id: "scrambled", en: "Scrambled", ar: "مخفوق", image: "/eggs-scrambled.webp" },
  { id: "poached", en: "Poached", ar: "مسلوق", image: "/eggs-poached.webp" },
]);

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function amount(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function isTwoEggsAnyStyle(item) {
  if (!item || typeof item !== "object") return false;
  const identity = resolveConfirmedMenuIdentity(item);
  if (isKnownMenuPlacementId(item.id)) return identity?.foodicsSku === "sk-1320";
  if (normalizeName(item.en) !== normalizeName(EGG_ITEM_NAME_EN)) return false;
  if (amount(item.price) !== EGG_PRICE_SAR) return false;
  const calories = amount(item.calories);
  return calories != null && Math.abs(calories - EGG_CALORIES) < 0.05;
}

export function eggPreparationById(optionId) {
  return EGG_PREPARATIONS.find((option) => option.id === optionId) || null;
}

/** Structured choice for a future QR order and kitchen ticket. */
export function eggPreparationSelection(optionId = DEFAULT_EGG_PREPARATION_ID) {
  const option = eggPreparationById(optionId) || eggPreparationById(DEFAULT_EGG_PREPARATION_ID);
  return {
    groupId: EGG_PREPARATION_GROUP_ID,
    optionId: option.id,
    labelEn: option.en,
    labelAr: option.ar,
    priceDeltaSar: 0,
    image: option.image,
  };
}

export function withEggPreparations(item) {
  if (!isTwoEggsAnyStyle(item)) return item;
  const selectedPreparationId = eggPreparationById(item.selectedPreparationId)
    ? item.selectedPreparationId
    : DEFAULT_EGG_PREPARATION_ID;
  return {
    ...item,
    preparations: EGG_PREPARATIONS,
    selectedPreparationId,
    preparationSelection: eggPreparationSelection(selectedPreparationId),
  };
}

/** Card title opens Scrambled. A collage photograph opens that preparation. */
export function openEggPreparation(item, optionId) {
  if (!isTwoEggsAnyStyle(item)) return item;
  const prepared = withEggPreparations({
    ...item,
    selectedPreparationId: undefined,
  });
  if (eggPreparationById(optionId)) return selectEggPreparation(prepared, optionId);
  return resetEggPreparation(prepared);
}

/** Each time the product is opened without a photograph choice, the selection starts at Scrambled. */
export function resetEggPreparation(item) {
  if (!isTwoEggsAnyStyle(item)) return item;
  const catalogueImage = isPreparationImage(item.image)
    ? item.originalImage || ""
    : item.image;
  return withEggPreparations({
    ...item,
    image: catalogueImage,
    originalImage: undefined,
    selectedPreparationId: DEFAULT_EGG_PREPARATION_ID,
  });
}

export function isPreparationImage(src) {
  return EGG_PREPARATIONS.some((option) => option.image === src);
}

export function selectEggPreparation(item, optionId) {
  if (!item?.preparations) return item;
  const option = eggPreparationById(optionId);
  if (!option) return item;
  return {
    ...item,
    selectedPreparationId: option.id,
    preparationSelection: eggPreparationSelection(option.id),
    image: option.image,
    originalImage: item.originalImage || item.image,
    price: item.price,
    calories: item.calories,
    allergens: item.allergens,
    recommended: item.recommended,
    id: item.id,
    en: item.en,
  };
}

export function activeEggPreparation(item) {
  if (!item?.preparations?.length) return null;
  return eggPreparationById(item.selectedPreparationId) || eggPreparationById(DEFAULT_EGG_PREPARATION_ID);
}

/** Main photograph. An add-on preview still wins until a preparation is chosen again. */
export function eggHeroImage(item) {
  const preparation = activeEggPreparation(item);
  if (!preparation) return item?.image || "";
  const addonPreview = (item.recommended || []).some(
    (addon) => addon.previewImage && addon.previewImage === item.image,
  );
  return addonPreview ? item.image : preparation.image;
}
