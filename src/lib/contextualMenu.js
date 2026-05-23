/** NAC contextual menu — business hours in Asia/Riyadh (aligned with 3 AM business day clock) */

import { NAC_BUSINESS_TZ } from "../dashboard/utils/businessDay";
import { isBrunchDay } from "./brunchSchedule";

function riyadhParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: NAC_BUSINESS_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const weekday = get("weekday");
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dow: dowMap[weekday] ?? date.getDay(),
    hour: Number(get("hour")) || 0,
    minute: Number(get("minute")) || 0,
  };
}

const ALWAYS = ["drinks", "desserts"];

/**
 * Active operational flow: primary food service + drinks + desserts.
 */
export function getContextualFlow(date = new Date()) {
  const { dow, hour, minute } = riyadhParts(date);
  const mins = hour * 60 + minute;

  let primary = "evening";
  let labelEn = "Evening";
  let labelAr = "المساء";

  if (mins >= 9 * 60 && mins < 12 * 60) {
    primary = "breakfast";
    labelEn = "Breakfast";
    labelAr = "الفطور";
  } else if (mins >= 12 * 60 && mins < 17 * 60) {
    if (isBrunchDay(dow)) {
      primary = "brunch";
      labelEn = "Brunch";
      labelAr = "برانش";
    } else {
      primary = "daytime";
      labelEn = "Daytime";
      labelAr = "النهار";
    }
  } else if (mins >= 17 * 60 || mins < 3 * 60) {
    primary = "evening";
    labelEn = "Evening";
    labelAr = "المساء";
  } else if (mins >= 3 * 60 && mins < 9 * 60) {
    primary = "drinks";
    labelEn = "Late Night";
    labelAr = "ليل";
  }

  const categories = [...new Set([primary, ...ALWAYS].filter((c) => c !== "drinks" || primary !== "drinks"))];
  if (!categories.includes("drinks")) categories.push("drinks");
  if (!categories.includes("desserts")) categories.push("desserts");

  return {
    primary,
    categories,
    labelEn,
    labelAr,
    isLateNight: mins >= 3 * 60 && mins < 9 * 60,
  };
}

export function isCategoryInActiveFlow(categoryId, flow = getContextualFlow()) {
  return flow.categories.includes(categoryId);
}

export function getContextualGreeting(flow, isArabic) {
  if (isArabic) {
    return `قائمة ${flow.labelAr} جاهزة لك`;
  }
  return `Your ${flow.labelEn} menu is ready`;
}
