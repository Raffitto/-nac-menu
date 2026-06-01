/**
 * Per-category artwork tuning for All Menus cards.
 * EN values are the optical baseline; AR values scale up to match EN visible weight
 * (Arabic PNGs are square canvases with more internal whitespace).
 *
 * Units: scale (unitless), x/y (px at desktop; scaled on mobile via CSS).
 */

const DEFAULT = { scale: 1, x: 0, y: 0 };

/** @type {Record<string, { en: typeof DEFAULT, ar: typeof DEFAULT }>} */
export const CATEGORY_ART_NORMALIZATION = {
  evening: {
    en: { scale: 1, x: 0, y: 0 },
    ar: { scale: 1.58, x: 0, y: 0 },
  },
  drinks: {
    en: { scale: 1, x: 0, y: 0 },
    ar: { scale: 1.34, x: 0, y: -1 },
  },
  desserts: {
    en: { scale: 1, x: 0, y: 0 },
    ar: { scale: 1.52, x: 0, y: 0 },
  },
  breakfast: {
    en: { scale: 1.08, x: 0, y: 0 },
    ar: { scale: 1.5, x: 0, y: 0 },
  },
  brunch: {
    en: { scale: 1, x: 0, y: 0 },
    ar: { scale: 1.3, x: 0, y: 0 },
  },
  daytime: {
    en: { scale: 1, x: 0, y: 0 },
    ar: { scale: 1.38, x: 0, y: 1 },
  },
};

/**
 * CSS custom properties for the artwork wrapper (slot geometry unchanged).
 * @param {string} categoryId
 * @param {boolean} isArabic
 * @returns {Record<string, string>}
 */
export function getCategoryArtStyle(categoryId, isArabic) {
  const lang = isArabic ? "ar" : "en";
  const tune = CATEGORY_ART_NORMALIZATION[categoryId]?.[lang] ?? DEFAULT;
  return {
    "--art-scale": String(tune.scale),
    "--art-x": `${tune.x}px`,
    "--art-y": `${tune.y}px`,
  };
}
