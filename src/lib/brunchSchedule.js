/** Brunch availability — Wed–Sat, 12–5 PM Asia/Riyadh. */

/** Day-of-week index (Sun=0 … Sat=6) in Asia/Riyadh. */
export const BRUNCH_DOW = new Set([3, 4, 5, 6]);

export function isBrunchDay(dow) {
  return BRUNCH_DOW.has(dow);
}

export const BRUNCH_SCHEDULE = {
  timeEn: "Wed–Sat · 12–5 PM",
  timeAr: "الأربعاء–السبت · ١٢–٥ م",
};

/** Daytime lunch menu — Sun–Tue at the same 12–5 PM window. */
export const DAYTIME_LUNCH_SCHEDULE = {
  timeEn: "Sun–Tue · 12–5 PM",
  timeAr: "الأحد–الثلاثاء · ١٢–٥ م",
};
