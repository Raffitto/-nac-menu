/**
 * Allergen codes printed on the approved NAC menus.
 * The code is kept for traceability. NAC shows the full name.
 * A code that is not in this list is not guessed.
 */

export const OFFICIAL_ALLERGENS = Object.freeze({
  n: { en: "Nuts", ar: "مكسرات" },
  g: { en: "Gluten", ar: "جلوتين" },
  se: { en: "Sesame", ar: "سمسم" },
  m: { en: "Mustard", ar: "خردل" },
  s: { en: "Soya", ar: "صويا" },
  e: { en: "Eggs", ar: "بيض" },
  d: { en: "Dairy", ar: "ألبان" },
  sul: { en: "Sulphite", ar: "كبريتات" },
  cr: { en: "Crustaceans", ar: "قشريات" },
  c: { en: "Celery", ar: "كرفس" },
  f: { en: "Fish", ar: "سمك" },
});

const CODE_ORDER = ["sul", "se", "cr", "n", "g", "m", "s", "e", "d", "c", "f"];

export function parseAllergenCodes(raw) {
  const tokens = String(raw || "")
    .replace(/[()]/g, " ")
    .split(/[,/]/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const found = new Set();
  const unknown = [];
  for (const token of tokens) {
    if (OFFICIAL_ALLERGENS[token]) found.add(token);
    else unknown.push(token);
  }
  const codes = CODE_ORDER.filter((code) => found.has(code));
  return {
    codes,
    unknown,
    names: codes.map((code) => OFFICIAL_ALLERGENS[code].en),
  };
}

export function allergenNamesForCodes(codes = []) {
  return CODE_ORDER.filter((code) => codes.includes(code)).map((code) => OFFICIAL_ALLERGENS[code].en);
}
