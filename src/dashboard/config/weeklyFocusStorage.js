const STORAGE_KEY = "nac_visual_os_weekly_focus_items";

export const DEFAULT_WEEKLY_FOCUS_ITEMS = [
  "Mac & Cheese",
  "Risotto",
  "Steak",
  "Vanilla",
  "Extra Shot",
  "Truffle Mayo",
  "Fries",
  "Asparagus",
  "Still Water",
  "Sparkling Water Big",
  "Sparkling Water Small",
];

export function loadWeeklyFocusItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_WEEKLY_FOCUS_ITEMS];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [...DEFAULT_WEEKLY_FOCUS_ITEMS];
  } catch {
    return [...DEFAULT_WEEKLY_FOCUS_ITEMS];
  }
}

export function saveWeeklyFocusItems(items) {
  const list = [...new Set((items || []).map((s) => String(s).trim()).filter(Boolean))];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return list;
}
