/** Brunch availability — Fri–Sat, 12–5 PM Asia/Riyadh. */

/** Day-of-week index (Sun=0 … Sat=6) in Asia/Riyadh. */
export const BRUNCH_DOW = new Set([5, 6]);

export function isBrunchDay(dow) {
  return BRUNCH_DOW.has(dow);
}

export const BRUNCH_SCHEDULE = {
  timeEn: "Fri–Sat · 12–5 PM",
  timeAr: "الجمعة–السبت · ١٢–٥ م",
};

/** Daytime lunch menu — Sun–Thu at the same 12–5 PM window. */
export const DAYTIME_LUNCH_SCHEDULE = {
  timeEn: "Sun–Thu · 12–5 PM",
  timeAr: "الأحد–الخميس · ١٢–٥ م",
};
