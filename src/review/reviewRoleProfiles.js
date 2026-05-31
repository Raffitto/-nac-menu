/**
 * Role-aware review language — frontline, supervisory, management, executive.
 * Used globally by reviewGeneratorEngine (all branches / portals).
 */

import { withHonorificEN, withHonorificAR } from "./reviewGeneratorShared";

export const ROLE_CATEGORIES = {
  FRONTLINE: "frontline",
  SUPERVISORY: "supervisory",
  MANAGEMENT: "management",
  EXECUTIVE: "executive",
};

/** Waiter-style phrases that must not appear in GM / executive reviews. */
export const FORBIDDEN_EXECUTIVE_PHRASES = [
  /\btaking orders?\b/i,
  /\btook (our |the )?order\b/i,
  /\bmenu recommendation/i,
  /\brecommended the\b/i,
  /\bserving food\b/i,
  /\bserved (our |the )?food\b/i,
  /\bupsell/i,
  /\btable[- ]side\b/i,
  /\bhandled our table\b/i,
  /\bkept checking on us\b/i,
  /\btook care of everything\b/i,
  /\bshoutout to\b/i,
  /\bwas on it\b/i,
  /\bwas sweet\b/i,
  /\bvery attentive\b/i,
  /\battentive team\b/i,
];

const ROLE_KEY_ALIASES = {
  waiter: "waiter",
  waitress: "waiter",
  server: "waiter",
  hostess: "waiter",
  host: "waiter",
  "training waiter": "waiter",
  receptionist: "receptionist",
  cashier: "cashier",
  supervisor: "supervisor",
  "floor supervisor": "supervisor",
  "shift leader": "supervisor",
  "shift supervisor": "supervisor",
  "assistant manager": "assistant_manager",
  arm: "assistant_manager",
  "assistant restaurant manager": "assistant_manager",
  "restaurant manager": "restaurant_manager",
  rm: "restaurant_manager",
  "operations manager": "restaurant_manager",
  "general manager": "general_manager",
  gm: "general_manager",
  "branch manager": "general_manager",
  team: "team",
};

function r(n) {
  return Math.floor(Math.random() * n);
}
function pick(a) {
  return a[r(a.length)];
}
function chance(p) {
  return Math.random() < p;
}

export function normalizeRoleKey(role) {
  const raw = String(role || "team")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return ROLE_KEY_ALIASES[raw] || raw.replace(/[^a-z0-9_ ]/g, "").replace(/ /g, "_") || "team";
}

export function resolveRoleCategory(role) {
  const key = normalizeRoleKey(role);
  if (key === "general_manager") return ROLE_CATEGORIES.EXECUTIVE;
  if (key === "restaurant_manager" || key === "assistant_manager") return ROLE_CATEGORIES.MANAGEMENT;
  if (key === "supervisor") return ROLE_CATEGORIES.SUPERVISORY;
  if (key === "receptionist" || key === "cashier" || key === "waiter") return ROLE_CATEGORIES.FRONTLINE;
  if (key === "team") return ROLE_CATEGORIES.FRONTLINE;
  return ROLE_CATEGORIES.FRONTLINE;
}

export function getReviewRoleProfile(role) {
  const roleKey = normalizeRoleKey(role);
  const category = resolveRoleCategory(role);

  const base = {
    roleKey,
    category,
    preferServiceFirst: false,
    allowManagerSnippet: false,
    structurePool: null,
    leadershipStructures: ["leadership_focus", "story_long", "atmosphere_only", "mixed_scatter"],
  };

  switch (category) {
    case ROLE_CATEGORIES.EXECUTIVE:
      return {
        ...base,
        preferServiceFirst: true,
        allowManagerSnippet: false,
        structurePool: base.leadershipStructures,
      };
    case ROLE_CATEGORIES.MANAGEMENT:
      return {
        ...base,
        preferServiceFirst: chance(0.55),
        allowManagerSnippet: false,
        structurePool: [
          "leadership_focus",
          "service_first",
          "story_long",
          "mixed_scatter",
          "atmosphere_only",
          "food_first",
        ],
      };
    case ROLE_CATEGORIES.SUPERVISORY:
      return {
        ...base,
        preferServiceFirst: chance(0.65),
        allowManagerSnippet: chance(0.12),
        structurePool: ["service_first", "mixed_scatter", "story_long", "waiter_focus", "food_first"],
      };
    default:
      return {
        ...base,
        preferServiceFirst: roleKey === "receptionist",
        allowManagerSnippet: true,
        structurePool: null,
      };
  }
}

function displayName(staff, roleKey, isAr) {
  if (roleKey === "receptionist") {
    return isAr ? withHonorificAR(staff) : withHonorificEN(staff);
  }
  return staff;
}

function buildFrontlineMention(staff, roleKey, personality, isAr) {
  if (!staff || staff === "Team") {
    return isAr ? "الفريق كان متعاون." : "The team was helpful.";
  }
  const name = displayName(staff, roleKey, isAr);
  const plain = staff;
  const honorEn = withHonorificEN(staff);
  const honorAr = withHonorificAR(staff);

  if (roleKey === "receptionist") {
    return isAr
      ? pick([
          `${honorAr} رحبت فينا بحرارة.`,
          `${name} رتبت الجلوس بسرعة.`,
          `الاستقبال مع ${name} كان سلس.`,
          `${name} قدّم تجربة ترحيب احترافية.`,
        ])
      : pick([
          `${name} welcomed us warmly.`,
          `${name} got us seated quickly.`,
          `${name} handled check-in smoothly.`,
          `${name} set a professional tone from the entrance.`,
        ]);
  }

  if (roleKey === "cashier") {
    return isAr
      ? pick([
          `${name} تعامل مع الطلب بسرعة واحتراف.`,
          `${name} سهّل عملية الدفع.`,
          `تعامل ${plain} كان منظم وواضح.`,
        ])
      : pick([
          `${plain} handled payment quickly and professionally.`,
          `${plain} kept the checkout process smooth.`,
          `${plain} was efficient and friendly at the counter.`,
        ]);
  }

  if (isAr) {
    return pick([
      `${honorAr} كان منتبهاً.`,
      `${name} خلّى الزيارة أسهل.`,
      `شكراً ${honorAr} على الخدمة.`,
      `${name} تابع معنا بشكل ممتاز.`,
      `تعامل ${name} كان راقي.`,
      `${plain} كان لطيف جداً.`,
      `${name} ساعدنا من أول لحظة.`,
      `${name} كان محترف في التعامل والترشيحات.`,
    ]);
  }

  const en = [
    `${plain} was very attentive.`,
    `${plain} was very attentive honestly`,
    `Thanks to ${honorEn} for the service.`,
    `${plain} made the experience smooth.`,
    `${honorEn} handled our table very professionally.`,
    `${plain} kept checking on us at the right time.`,
    `Shoutout to ${plain} — solid service.`,
    `${plain} was friendly and knowledgeable about the menu.`,
    `Really appreciated ${plain} today.`,
    `${plain} took care of everything.`,
    `Loved the vibe. ${plain} was on it.`,
    `${plain} gave great recommendations and stayed professional throughout.`,
  ];

  if (personality === "typo_heavy" || personality === "casual_young") {
    en.push(`${plain.toLowerCase()} was very attentive honestly`);
    en.push(`${plain} was great lol`);
  }
  if (personality === "minimalist") {
    return pick([`${plain} was great.`, `${plain} — good service.`, `${plain} 👍`]);
  }
  return pick(en);
}

function buildSupervisoryMention(staff, personality, isAr) {
  if (!staff || staff === "Team") {
    return isAr
      ? "كان الإشراف على الصالة واضح والخدمة مرتبة."
      : "Floor supervision was visible and service stayed organized.";
  }
  const plain = staff;
  const honorEn = withHonorificEN(staff);
  const honorAr = withHonorificAR(staff);

  if (isAr) {
    return pick([
      `${honorAr} كان حاضر على الصالة ونسّق الفريق بشكل ممتاز.`,
      `${plain} تابع ضيوفنا بسرعة وحل أي ملاحظة باحتراف.`,
      `تنسيق ${plain} خلّى الخدمة سلسة حتى في وقت الزحمة.`,
      `${honorAr} دعم الفريق واضح والتجربة كانت مرتبة.`,
    ]);
  }

  const en = [
    `${plain} had a strong floor presence and kept service flowing smoothly.`,
    `${honorEn} coordinated the team well and responded quickly when we needed anything.`,
    `${plain} supported the staff visibly and made sure guests were taken care of.`,
    `Service stayed organized during a busy period — ${plain} handled it professionally.`,
    `${plain} resolved a small issue quickly and kept the atmosphere calm.`,
  ];
  if (personality === "minimalist") {
    return pick([`${plain} kept the floor running smoothly.`, `${plain} — solid supervision.`]);
  }
  return pick(en);
}

function buildManagementMention(staff, personality, isAr) {
  if (!staff || staff === "Team") {
    return isAr
      ? "كان الإدارة واضحة والمطعم مرتب."
      : "The restaurant felt well managed and professionally run.";
  }
  const plain = staff;
  const honorEn = withHonorificEN(staff);

  if (isAr) {
    return pick([
      `${plain} أدار التجربة باحتراف ووضوح في المعايير.`,
      `تنظيم ${plain} للفريق كان واضح والخدمة ثابتة.`,
      `${plain} اهتم برضا الضيوف وظهرت جودة التشغيل.`,
      `المطعم كان مرتباً و${plain} قاد الخدمة بشكل ممتاز.`,
    ]);
  }

  const en = [
    `The restaurant was well organized and professionally managed. ${plain} kept service timing and staff coordination on point.`,
    `${plain} showed strong hospitality leadership — guest needs were handled exceptionally well.`,
    `${honorEn} maintained clear service standards and the team performed consistently.`,
    `Operations felt controlled and guest-focused under ${plain}'s management.`,
    `${plain} balanced leadership and attention to detail — a smooth visit overall.`,
    `Service standards were high and ${plain} made sure the team delivered consistently.`,
  ];
  if (personality === "minimalist") {
    return pick([
      `${plain} ran a tight, professional service.`,
      `Well managed — thanks to ${plain}.`,
    ]);
  }
  return pick(en);
}

function buildExecutiveMention(staff, personality, isAr) {
  if (!staff || staff === "Team") {
    return isAr
      ? "القيادة التشغيلية كانت واضحة والتجربة احترافية."
      : "Leadership was visible and the operation felt professionally run.";
  }
  const plain = staff;

  if (isAr) {
    return pick([
      `${plain} كان حاضراً في الصالة وأظهر قيادة ممتازة. الفريق اشتغل بكفاءة والخدمة بقيت ثابتة حتى في وقت الزحمة.`,
      `${plain} حافظ على معايير عالية ورضا الضيوف كان واضحاً. التجربة عكست إدارة تشغيلية قوية.`,
      `ثقافة الضيافة واضحة تحت قيادة ${plain} — تنظيم ممتاز وتنسيق فريق محترف.`,
      `${plain} قاد التشغيل باحتراف وخلّى الأجواء مريحة والخدمة منظمة.`,
    ]);
  }

  const en = [
    `${plain} maintained a strong presence throughout the restaurant and demonstrated excellent leadership. The team operated efficiently, service remained consistent during busy periods, and guest satisfaction was clearly a priority.`,
    `${plain} showed visible management on the floor and strong operational control. Service standards were high and the team coordination was impressive.`,
    `The overall experience reflected professional management — ${plain} kept operations smooth and guest-focused culture evident.`,
    `${plain} led with professionalism and problem-solving was handled discreetly. Atmosphere and service quality both felt intentional.`,
    `Operational excellence was clear: ${plain} ensured the team executed well and the guest experience stayed polished throughout.`,
    `${plain} demonstrated strong leadership and culture on the floor. Busy periods were handled calmly and standards never dropped.`,
    `Guest experience felt prioritized under ${plain}'s leadership — organized service, a well-coordinated team, and a well-run restaurant.`,
  ];

  if (personality === "minimalist") {
    return pick([
      `${plain} showed excellent leadership — smooth operations and happy guests.`,
      `Strong management presence from ${plain}. Professional throughout.`,
    ]);
  }
  return pick(en);
}

/** Role-specific staff mention (replaces generic waiter-only lines). */
export function buildStaffMention(staff, role, personality, isAr) {
  const profile = getReviewRoleProfile(role);
  const roleKey = profile.roleKey;

  switch (profile.category) {
    case ROLE_CATEGORIES.EXECUTIVE:
      return buildExecutiveMention(staff, personality, isAr);
    case ROLE_CATEGORIES.MANAGEMENT:
      return buildManagementMention(staff, personality, isAr);
    case ROLE_CATEGORIES.SUPERVISORY:
      return buildSupervisoryMention(staff, personality, isAr);
    default:
      return buildFrontlineMention(staff, roleKey, personality, isAr);
  }
}

export function selectStructureForRole(personality, lengthClass, meal, role) {
  const profile = getReviewRoleProfile(role);

  if (lengthClass === "very_short") {
    if (profile.category === ROLE_CATEGORIES.EXECUTIVE) {
      return pick(["leadership_focus", "quick_line"]);
    }
    if (profile.category === ROLE_CATEGORIES.MANAGEMENT) {
      return pick(["leadership_focus", "quick_line", "service_first"]);
    }
    const short = ["quick_line", "waiter_focus", "food_only"];
    if (meal.period !== "dinner") short.push("coffee_only");
    return pick(short);
  }

  if (lengthClass === "long_story") {
    if (profile.category === ROLE_CATEGORIES.EXECUTIVE || profile.category === ROLE_CATEGORIES.MANAGEMENT) {
      return "leadership_focus";
    }
    return "story_long";
  }

  if (profile.structurePool?.length) {
    let pool = [...profile.structurePool];
    if (meal.period === "dinner") {
      pool = pool.filter((s) => s !== "coffee_only" && s !== "dessert_only");
    }
    if (personality === "business_lunch" && profile.category !== ROLE_CATEGORIES.FRONTLINE) {
      return pick(["leadership_focus", "service_first", "atmosphere_only"]);
    }
    return pick(pool);
  }

  return null;
}

export function containsForbiddenExecutiveLanguage(text) {
  return FORBIDDEN_EXECUTIVE_PHRASES.some((re) => re.test(text));
}

export function validateRoleLanguage(text, role) {
  const profile = getReviewRoleProfile(role);
  if (profile.category === ROLE_CATEGORIES.EXECUTIVE && containsForbiddenExecutiveLanguage(text)) {
    return { ok: false, reason: "executive_waiter_phrase" };
  }
  return { ok: true };
}
