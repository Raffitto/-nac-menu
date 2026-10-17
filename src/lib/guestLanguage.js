export const GUEST_LANGUAGE_KEY = "nacGuestLanguage";

function normalizeLanguageTag(tag) {
  return String(tag || "").trim().toLowerCase().replace(/_/g, "-");
}

/** First supported language in preference order. Arabic variants map to ar; everything else falls through to English. */
export function detectGuestLanguage(languages) {
  const list = Array.isArray(languages) ? languages : [languages];
  for (const tag of list) {
    const value = normalizeLanguageTag(tag);
    if (!value) continue;
    if (value === "ar" || value.startsWith("ar-")) return "ar";
    if (value === "en" || value.startsWith("en-")) return "en";
  }
  return "en";
}

/**
 * 1. Saved manual choice
 * 2. Browser language list
 * 3. English
 * An automatic detection is not written back as a saved choice.
 */
export function readGuestLanguage(storage, languages = []) {
  try {
    const saved = storage?.getItem(GUEST_LANGUAGE_KEY);
    if (saved === "en" || saved === "ar") return saved;
  } catch {
    // Storage can be blocked. Fall through to the device language.
  }
  return detectGuestLanguage(languages);
}

export function writeGuestLanguage(storage, lang) {
  if (lang !== "en" && lang !== "ar") return;
  try {
    storage?.setItem(GUEST_LANGUAGE_KEY, lang);
  } catch {
    // Ignore storage failures. The in-memory choice still applies.
  }
}
