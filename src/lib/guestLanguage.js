export const GUEST_LANGUAGE_KEY = "nacGuestLanguage";

/** New visitors start in English. A saved en/ar choice is kept across reloads. */
export function readGuestLanguage(storage) {
  try {
    const saved = storage?.getItem(GUEST_LANGUAGE_KEY);
    if (saved === "en" || saved === "ar") return saved;
  } catch {
    // Storage can be blocked. English remains the guest default.
  }
  return "en";
}

export function writeGuestLanguage(storage, lang) {
  if (lang !== "en" && lang !== "ar") return;
  try {
    storage?.setItem(GUEST_LANGUAGE_KEY, lang);
  } catch {
    // Ignore storage failures. The in-memory choice still applies.
  }
}
