/**
 * Personalized NAC review text generator.
 * Khobar uses real menu-only generator; other branches use legacy pools.
 */

import { generateKhobarReview } from "./reviewGeneratorKhobar";
import {
  canonName,
  withHonorificEN,
  withHonorificAR,
} from "./reviewGeneratorShared";

export { canonName, withHonorificEN, withHonorificAR };

export const GOOGLE_PLACE_IDS = {
  khobar: "ChIJp_zLEdvpST4RPD2r1GX-ASw",
  jeddah: "ChIJg_3_793bwxUR6w9WMTA96F8",
  riyadh: "ChIJWVLeDGEdLz4RNTDq3dMM4nM",
};

const BRANCH_LABELS = {
  khobar: { en: "NAC Khobar", ar: "NAC الخبر" },
  jeddah: { en: "NAC Jeddah", ar: "NAC جدة" },
  riyadh: { en: "NAC Riyadh", ar: "NAC الرياض" },
};

const FOODS = [
  { en: "popcorn chicken", ar: "بوبكورن تشيكن" },
  { en: "cajun chicken with fries", ar: "دجاج كاجون مع بطاطس" },
  { en: "Black Angus steak with fries", ar: "ستيك بلاك أنجوس مع بطاطس" },
  { en: "truffle corn risotto with chicken on top", ar: "ريزوتو ذرة بالكمأة مع دجاج" },
  { en: "kale salad", ar: "سلطة كيل" },
  { en: "rigatoni pasta with chicken sumac on top", ar: "ريغاتوني مع دجاج سماق" },
  { en: "oven baked mac & cheese", ar: "ماك آند تشيز بالفرن" },
  { en: "crushed burrata", ar: "بوراتا مفتتة" },
  { en: "truffle burger", ar: "ترافل برجر" },
];

const DRINKS = [
  { en: "cappuccino", ar: "كابتشينو" },
  { en: "flat white", ar: "فلات وايت" },
  { en: "latte", ar: "لاتيه" },
  { en: "raspberry mojito", ar: "موهيتو توت" },
  { en: "passion fruit lemonade", ar: "ليمونادة باشن فروت" },
  { en: "fresh orange juice", ar: "عصير برتقال فريش" },
  { en: "raspberry cranberry lemonade", ar: "ليمونادة توت وكرانبيري" },
  { en: "blackberry vanilla lemon", ar: "بلاكبيري فانيلا ليمون" },
];

const SERV_REC_EN = [
  "We were greeted with a smile and seated smoothly.",
  "Seating was organized and the process was quick.",
  "Warm welcome and clear guidance to the table.",
  "They managed the flow calmly even with a bit of crowd.",
  "The hostess was friendly and got us seated smoothly.",
  "Waiting time felt well handled and the seating process was easy.",
];

const SERV_REC_AR = [
  "الاستقبال كان لطيفاً وتمت مساعدتنا بسرعة.",
  "تم ترتيب الجلوس بسرعة وبهدوء.",
  "الترحيب كان بابتسامة وخدمة راقية.",
  "وقت الانتظار كان منظم ومريح.",
  "موظفة الاستقبال كانت ودودة وسهلت الجلسة.",
  "ترتيب الجلوس كان ممتاز وسلس.",
];

const SERV_WAITER_EN = [
  "Timing was great, we never had to chase anyone.",
  "They checked on us at the right moments.",
  "Requests were handled quickly and calmly.",
  "Everything arrived in a good flow.",
  "Attentive service without hovering.",
];

const SERV_WAITER_AR = [
  "الطلبات وصلت بوقت ممتاز.",
  "كان الاهتمام ممتاز بدون إزعاج.",
  "الخدمة كانت سريعة ومرتبة.",
  "التعامل كان محترم وعملي.",
];

const SERV_SUP_EN = [
  "The floor felt organized and well controlled.",
  "Good leadership on the floor, everything stayed aligned.",
  "They kept service moving smoothly during the rush.",
];

const SERV_SUP_AR = [
  "كان التنظيم واضحاً وإدارة الصالة ممتازة.",
  "تم حل أي ملاحظة بسرعة.",
  "المتابعة كانت جيدة خصوصاً وقت الزحمة.",
];

const SERV_FM_EN = [
  "The floor felt organized and well controlled.",
  "Good leadership on the floor, everything stayed aligned.",
  "The service rhythm was smooth and well directed.",
];

const SERV_FM_AR = [
  "إدارة الصالة كانت ممتازة والتنظيم واضح.",
  "المتابعة كانت احترافية والخدمة منسقة.",
  "كان هناك تحكم ممتاز في سير الخدمة.",
];

const SERV_GM_EN = [
  "Very professional pacing and guest care.",
  "High standards with consistent execution.",
  "Management presence was clear and the team was sharp.",
];

const SERV_GM_AR = [
  "الإدارة احترافية ومستوى الخدمة عالي.",
  "التنظيم ممتاز من البداية للنهاية.",
  "تجربة راقية ومعايير واضحة.",
];

const CLOSE_EN = [
  "Thank you, recommended.",
  "Appreciate it, we will be back.",
  "Thanks to the team, highly recommended.",
  "Great job, see you again soon.",
  "Really appreciate the service.",
  "Keep it up, recommended.",
];

const CLOSE_AR = [
  "شكراً لكم، أنصح به.",
  "يعطيكم العافية، أكيد نرجع.",
  "شكراً للفريق على الخدمة.",
  "ممتاز جداً، نراكم قريباً.",
  "شكراً على الاهتمام.",
];

const ENV_EN = [
  "The place felt comfortable and clean.",
  "Nice atmosphere, not too loud.",
  "Everything looked tidy and well kept.",
  "Good vibe and very welcoming.",
];

const ENV_AR = [
  "المكان نظيف ومرتب.",
  "الأجواء مريحة جداً.",
  "كل شيء كان منظم وواضح.",
  "الانطباع كان ممتاز.",
];

const SHORT_ONLY_EN = [
  "Great service, thank you.",
  "Fast and organized, recommended.",
  "Everything was smooth, appreciate it.",
  "Simple, quick, and professional. Thank you.",
];

const SHORT_ONLY_AR = [
  "خدمة ممتازة، شكراً لكم.",
  "سريع ومرتب، أنصح به.",
  "كل شيء كان سلس، يعطيكم العافية.",
  "تجربة جميلة، شكراً لكم.",
];

function r(n) {
  return Math.floor(Math.random() * n);
}
function pick(a) {
  return a[r(a.length)];
}
function chance(p) {
  return Math.random() < p;
}
function capFirst(s) {
  s = String(s || "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function itemName(it, isAr) {
  return isAr ? it.ar : it.en;
}
function pick2Different(arr) {
  if (arr.length < 2) return [pick(arr)];
  const a = pick(arr);
  let b = pick(arr);
  let g = 0;
  while (b === a && g < 12) {
    b = pick(arr);
    g++;
  }
  return [a, b];
}
function maybeEmoji(isAr) {
  if (!chance(0.22)) return "";
  const e = isAr
    ? ["😍", "👌", "🔥", "💛", "✨", "😋", "👏", "✅"]
    : ["😍", "👌", "🔥", "💛", "✨", "😋", "👏", "✅", "🥰"];
  return ` ${pick(e)}`;
}

function branchLabel(branchId, isAr) {
  const b = (branchId || "khobar").toLowerCase();
  return BRANCH_LABELS[b]?.[isAr ? "ar" : "en"] || (isAr ? "NAC" : "NAC");
}

function openers(branchId, isAr) {
  const place = branchLabel(branchId, isAr);
  if (isAr) {
    return [
      `زرنا ${place} اليوم وكانت التجربة ممتازة.`,
      `كانت زيارة جميلة اليوم وكل شيء كان سلساً.`,
      `تجربة مريحة جداً اليوم في ${place}.`,
      `كل شيء كان مرتباً وسريعاً في زيارتنا اليوم.`,
      `زيارة سريعة لكنها كانت ممتازة.`,
      `الأجواء كانت جميلة والخدمة ممتازة.`,
    ];
  }
  return [
    `Visited ${place} and left happy.`,
    "Had a really pleasant visit today.",
    "Dropped in and the service was on point.",
    "Came by for a quick meal and it delivered.",
    "We had a great time here today.",
    "Everything ran smoothly on our visit.",
    "Good energy and great timing.",
    `This ${place} visit was a great choice today.`,
    "Came in hungry and left satisfied.",
  ];
}

function openerNoRepeat(branchId, isAr) {
  const storeSlug = (branchId || "khobar").toLowerCase();
  const key = `${isAr ? "nac_last_open_ar_" : "nac_last_open_en_"}${storeSlug}`;
  const arr = openers(branchId, isAr);
  let o = pick(arr);
  try {
    const last = sessionStorage.getItem(key) || "";
    let g = 0;
    while (o === last && g < 16) {
      o = pick(arr);
      g++;
    }
    sessionStorage.setItem(key, o);
  } catch {
    /* ignore */
  }
  return o;
}

function normRole(role) {
  return String(role || "team")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function servicePool(roleRaw, isAr) {
  const role = normRole(roleRaw);
  if (role === "receptionist") return isAr ? SERV_REC_AR : SERV_REC_EN;
  if (role === "supervisor") return isAr ? SERV_SUP_AR : SERV_SUP_EN;
  if (role === "floor manager" || role === "fm")
    return isAr ? SERV_FM_AR : SERV_FM_EN;
  if (role === "gm" || role === "rm" || role === "arm")
    return isAr ? SERV_GM_AR : SERV_GM_EN;
  if (role === "waiter" || role === "training waiter")
    return isAr ? SERV_WAITER_AR : SERV_WAITER_EN;
  return isAr ? SERV_WAITER_AR : SERV_WAITER_EN;
}

function nameBits(staff, isAr) {
  const staffEN = withHonorificEN(staff);
  const staffAR = withHonorificAR(staff);
  return isAr
    ? [
        `شكراً لـ ${staffAR}.`,
        `تعامل ${staffAR} كان ممتاز.`,
        `${staffAR} اهتم فينا من البداية للنهاية.`,
        `كل الشكر لـ ${staffAR} على الاهتمام.`,
        `بصراحة ${staffAR} خلى التجربة أسهل بكثير.`,
      ]
    : [
        `Thanks to ${staffEN}.`,
        `${staffEN} was excellent.`,
        `Really appreciate ${staffEN}.`,
        `${staffEN} made the visit smooth.`,
        `Shoutout to ${staffEN} for the great service.`,
        `${staffEN} took care of us perfectly.`,
      ];
}

function buildReview(staff, roleRaw, branchId, isAr) {
  const roll = Math.random();
  const veryShort = roll < 0.45;
  const medium = roll >= 0.85;
  const mentionFood = chance(0.84);
  const mentionDrink = chance(0.55);
  const mentionEnv = chance(0.35);
  const serv = servicePool(roleRaw, isAr);
  const place = pick(["start", "middle", "end"]);
  const bits = nameBits(staff, isAr);
  const [f1, f2] = pick2Different(FOODS);
  const [d1, d2] = pick2Different(DRINKS);
  const foodOne = pick(FOODS);
  const drinkOne = pick(DRINKS);

  const foodLine1 = isAr
    ? `جربنا ${itemName(foodOne, true)} وكانت لذيذة جداً.`
    : `We tried ${capFirst(itemName(foodOne, false))} and it was really good.`;
  const foodLine2 = isAr
    ? `طلبنا ${itemName(f1, true)} و ${itemName(f2, true)} وكل شيء كان مضبوط.`
    : `We ordered ${itemName(f1, false)} and ${itemName(f2, false)}, everything was on point.`;
  const drinkLine1 = isAr
    ? `وأخذنا ${itemName(drinkOne, true)} وكانت ممتازة.`
    : `We also had a ${itemName(drinkOne, false)}, it was great.`;
  const drinkLine2 = isAr
    ? `المشروبات ممتازة خصوصاً ${itemName(d1, true)} و ${itemName(d2, true)}.`
    : `Drinks were great, especially the ${itemName(d1, false)} and the ${itemName(d2, false)}.`;

  const parts = [];

  if (veryShort) {
    if (chance(0.58)) {
      if (place === "start") parts.push(pick(bits));
      parts.push(pick(serv));
      if (mentionFood && chance(0.5)) parts.push(chance(0.35) ? foodLine1 : foodLine2);
      else if (mentionDrink && chance(0.25)) parts.push(drinkLine1);
      parts.push(pick(isAr ? CLOSE_AR : CLOSE_EN) + maybeEmoji(isAr));
      if (place === "end") parts.push(pick(bits));
    } else {
      parts.push(pick(isAr ? SHORT_ONLY_AR : SHORT_ONLY_EN) + maybeEmoji(isAr));
      if (chance(0.5)) parts.push(pick(bits));
      if (mentionFood && chance(0.45)) parts.push(foodLine1);
    }
    return parts.join(" ");
  }

  parts.push(openerNoRepeat(branchId, isAr) + maybeEmoji(isAr));
  if (place === "start") parts.push(pick(bits));
  parts.push(pick(serv));
  if (mentionFood) parts.push(chance(0.28) && mentionDrink ? foodLine2 : pick([foodLine1, foodLine2]));
  if (mentionDrink && chance(0.7)) parts.push(pick([drinkLine1, drinkLine2]));
  if (mentionEnv) parts.push(pick(isAr ? ENV_AR : ENV_EN));
  if (place === "middle") parts.push(pick(bits));
  if (medium && chance(0.4)) {
    parts.push(isAr ? "أكيد نرجع مرة ثانية." : "We will definitely come back.");
  }
  parts.push(pick(isAr ? CLOSE_AR : CLOSE_EN) + maybeEmoji(isAr));
  if (place === "end") parts.push(pick(bits));

  return parts.join(" ");
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `0000000${h.toString(16)}`.slice(-8);
}

function normReview(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .trim();
}

function getRecentArr(key) {
  try {
    const raw = sessionStorage.getItem(key) || "[]";
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function pushRecentArr(key, value, limit) {
  try {
    const arr = getRecentArr(key);
    arr.unshift(value);
    sessionStorage.setItem(key, JSON.stringify(arr.slice(0, limit)));
  } catch {
    /* ignore */
  }
}

function generateUnique(staff, roleRaw, branchId, isAr) {
  const branch = (branchId || "khobar").toLowerCase();
  const langKey = isAr ? "ar" : "en";
  const globalKey = `nac_global_recent_${branch}_${langKey}`;
  const staffKey = `nac_staff_recent_${branch}_${langKey}_${String(staff || "").toLowerCase()}`;
  const globalRecent = getRecentArr(globalKey);
  const staffRecent = getRecentArr(staffKey);
  let bestFallback = "";
  let bestScore = -1;

  for (let i = 0; i < 90; i++) {
    let txt = buildReview(staff, roleRaw, branch, isAr).replace(/\s+/g, " ").trim();
    if (!txt) continue;

    const staffLower = String(staff || "").toLowerCase();
    if (staff && staff !== "Team" && !txt.toLowerCase().includes(staffLower)) {
      txt = isAr
        ? `شكراً لـ ${withHonorificAR(staff)}. ${txt}`
        : `Thanks to ${withHonorificEN(staff)}. ${txt}`;
    }

    const hash = fnv1a(normReview(txt));
    const dupGlobal = globalRecent.includes(hash);
    const dupStaff = staffRecent.includes(hash);

    if (!dupGlobal && !dupStaff) {
      pushRecentArr(globalKey, hash, 20);
      pushRecentArr(staffKey, hash, 8);
      return txt;
    }

    const score = (dupGlobal ? 0 : 1) + (dupStaff ? 0 : 1);
    if (score > bestScore) {
      bestScore = score;
      bestFallback = txt;
    }
  }

  if (bestFallback) {
    const hash = fnv1a(normReview(bestFallback));
    pushRecentArr(globalKey, hash, 20);
    pushRecentArr(staffKey, hash, 8);
    return bestFallback;
  }

  return isAr ? "تجربة ممتازة وخدمة رائعة." : "Great experience and excellent service.";
}

/**
 * @param {{ staffName?: string, role?: string, branchId?: string, language?: string }} opts
 */
export function generatePersonalizedReview(opts = {}) {
  const branchId = (opts.branchId || "khobar").toLowerCase();
  if (branchId === "khobar") {
    return generateKhobarReview(opts);
  }
  const staff = canonName(opts.staffName);
  const roleRaw = normRole(opts.role);
  const isAr = opts.language === "ar";
  return generateUnique(staff, roleRaw, branchId, isAr);
}

export function getGoogleReviewUrl(branchId) {
  const placeId = GOOGLE_PLACE_IDS[(branchId || "khobar").toLowerCase()];
  if (!placeId) return null;
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}
