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

/** Roles that use Mr. / الأستاذ (gm, general manager, branch manager, restaurant manager, assistant manager). */
const HONORIFIC_ROLE_KEYS = new Set([
  "general_manager",
  "restaurant_manager",
  "assistant_manager",
]);

/** Waiter-style phrases that must not appear in GM / management reviews. */
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

/** Consultant / operational-report tone — reject and regenerate. */
export const CONSULTANT_LANGUAGE_PATTERNS = [
  /\boperational excellence\b/i,
  /\bdemonstrated (excellent |strong )?leadership\b/i,
  /\bexcellent leadership\b/i,
  /\bstrong leadership\b/i,
  /\bstrong operational\b/i,
  /\boperational control\b/i,
  /\bguest satisfaction\b/i,
  /\bhospitality leadership\b/i,
  /\bservice standards were\b/i,
  /\bstandards (were|never|stayed) (high|clear)\b/i,
  /\bguest-focused culture\b/i,
  /\bcoordinated execution\b/i,
  /\bteam coordination\b/i,
  /\bteam operated\b/i,
  /\bthe team executed\b/i,
  /\boperations felt\b/i,
  /\bprofessionally run\b/i,
  /\bprofessionally managed\b/i,
  /\breflect(ed)? professional management\b/i,
  /\bculture (on the floor|was evident)\b/i,
  /\bquality of the operation\b/i,
  /\bindustrial\b/i,
  /\bcompliance\b/i,
  /\bleadership\b/i,
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

export function isManagementHonorificRole(role) {
  return HONORIFIC_ROLE_KEYS.has(normalizeRoleKey(role));
}

export function managementHonorificPresent(text) {
  if (/[\u0600-\u06FF]/.test(text)) return /الأستاذ/.test(text);
  return /\bMr\.\s+\S/i.test(text);
}

/** Mr. Name (EN) / الأستاذ Name (AR) for GM and restaurant management roles. */
export function managementDisplayName(staff, isAr) {
  if (!staff || staff === "Team") {
    return isAr ? "الفريق" : "the team";
  }
  return isAr ? `الأستاذ ${staff}` : `Mr. ${staff}`;
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
    guestManagementStructures: ["mixed_scatter", "story_long", "atmosphere_only", "service_first", "food_first"],
  };

  switch (category) {
    case ROLE_CATEGORIES.EXECUTIVE:
      return {
        ...base,
        preferServiceFirst: chance(0.5),
        allowManagerSnippet: false,
        structurePool: base.guestManagementStructures,
      };
    case ROLE_CATEGORIES.MANAGEMENT:
      return {
        ...base,
        preferServiceFirst: chance(0.45),
        allowManagerSnippet: false,
        structurePool: [...base.guestManagementStructures, "quick_line"],
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
    `Shoutout to ${plain}, solid service.`,
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
    return pick([`${plain} was great.`, `${plain}, good service.`, `${plain} 👍`]);
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
    `Service stayed organized during a busy period. ${plain} handled it well.`,
    `${plain} resolved a small issue quickly and kept the atmosphere calm.`,
  ];
  if (personality === "minimalist") {
    return pick([`${plain} kept the floor running smoothly.`, `${plain}, solid supervision.`]);
  }
  return pick(en);
}

function buildGuestManagementMention(staff, personality, isAr, tier) {
  const name = managementDisplayName(staff, isAr);
  const isGm = tier === "executive";

  if (!staff || staff === "Team") {
    return isAr
      ? "المطعم كان مرتب والخدمة سلسة."
      : "The restaurant felt organized and service was smooth.";
  }

  if (isAr) {
    const arGm = [
      `${name} كان موجود في الصالة والزيارة كانت مريحة. الفريق شغال سوا والخدمة ما تأخرت.`,
      `زيارة حلوة. ${name} ظهر في الصالة والمطعم كان مرتب حتى مع الزحمة.`,
      `${name} رحّب فينا وخلّى الجو مريح. حسّينا بالترحيب من أول دقيقة.`,
      `وقت الزحمة والكل ماشي بسلاسة. ${name} كان موجود والطاقم متعاون.`,
      `تجربة ناجحة. ${name} واضح في الصالة والخدمة كانت ثابتة.`,
    ];
    const arRm = [
      `${name} كان حاضر والمطعم مرتب. الخدمة سلسة والفريق متعاون.`,
      `${name} تابع الضيوف والجو مريح. نرجع أكيد.`,
      `زيارة ممتازة. ${name} خلّى التجربة منظمة والخدمة ما تأخرت.`,
      `${name} كان موجود والطاقم شغال بانسجام.`,
    ];
    return pick(isGm ? arGm : arRm);
  }

  const enGm = [
    `${name} was around during our visit and the restaurant felt organized. Staff worked well together and service stayed smooth even when it got busy.`,
    `Great evening. ${name} had a visible presence on the floor and everyone seemed comfortable. We felt welcomed from the start.`,
    `Busy night but everything stayed calm. ${name} was checking in with guests and the team kept up. Would come back.`,
    `${name} was on the floor and the place ran smoothly. Food came on time and the vibe was relaxed. Happy we came here.`,
    `Really nice visit. ${name} was around and you could tell the staff worked well together. Service felt easy, not rushed.`,
    `Loved it here. ${name} was visible during a busy period and guests still felt looked after. Definitely returning.`,
    `${name} made the visit feel relaxed. Restaurant felt organized and the team was friendly throughout.`,
    `We felt welcomed right away. ${name} was present on the floor and service stayed smooth the whole meal.`,
  ];

  const enRm = [
    `The restaurant felt organized and ${name} was around when we needed anything. Staff worked well together.`,
    `${name} kept things running smoothly. Service timing was good and we felt welcomed.`,
    `Solid visit. ${name} was on the floor and the team seemed in sync. Would return.`,
    `${name} was present and the meal flowed nicely. Place felt calm even with other tables full.`,
    `Good experience. ${name} checked in with guests and the restaurant felt well run.`,
    `${name} was around and service never felt chaotic. Friendly team, smooth night.`,
  ];

  const pool = isGm ? enGm : enRm;
  if (personality === "minimalist") {
    return pick([
      `${name} was around. Smooth visit, would return.`,
      `Good night. ${name} on the floor, staff worked well.`,
    ]);
  }
  return pick(pool);
}

function buildManagementMention(staff, personality, isAr) {
  return buildGuestManagementMention(staff, personality, isAr, "management");
}

function buildExecutiveMention(staff, personality, isAr) {
  return buildGuestManagementMention(staff, personality, isAr, "executive");
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
    if (profile.category === ROLE_CATEGORIES.EXECUTIVE || profile.category === ROLE_CATEGORIES.MANAGEMENT) {
      return pick(["quick_line", "mixed_scatter", "atmosphere_only"]);
    }
    const short = ["quick_line", "waiter_focus", "food_only"];
    if (meal.period !== "dinner") short.push("coffee_only");
    return pick(short);
  }

  if (lengthClass === "long_story") {
    if (profile.category === ROLE_CATEGORIES.EXECUTIVE || profile.category === ROLE_CATEGORIES.MANAGEMENT) {
      return pick(["story_long", "mixed_scatter", "atmosphere_only"]);
    }
    return "story_long";
  }

  if (profile.structurePool?.length) {
    let pool = [...profile.structurePool];
    if (meal.period === "dinner") {
      pool = pool.filter((s) => s !== "coffee_only" && s !== "dessert_only");
    }
    if (personality === "business_lunch" && profile.category !== ROLE_CATEGORIES.FRONTLINE) {
      return pick(["mixed_scatter", "atmosphere_only", "service_first"]);
    }
    return pick(pool);
  }

  return null;
}

/** Strip AI-style dashes and heavy semicolon chains. */
export function sanitizeReviewPunctuation(text) {
  let out = String(text || "")
    .replace(/[\u2013\u2014]/g, ", ")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ");

  const semis = (out.match(/;/g) || []).length;
  if (semis > 0) {
    out = out.replace(/;/g, ".");
  }

  return out
    .replace(/,\s*,/g, ",")
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*\./g, ".")
    .replace(/\s+/g, " ")
    .replace(/ \./g, ".")
    .trim();
}

export function containsForbiddenExecutiveLanguage(text) {
  return FORBIDDEN_EXECUTIVE_PHRASES.some((re) => re.test(text));
}

export function containsConsultantLanguage(text) {
  return CONSULTANT_LANGUAGE_PATTERNS.some((re) => re.test(text));
}

export function containsAiPunctuation(text) {
  return /[\u2013\u2014]/.test(text) || (text.match(/;/g) || []).length > 1;
}

export function validateRoleLanguage(text, role) {
  const profile = getReviewRoleProfile(role);
  const isGuestManagement =
    profile.category === ROLE_CATEGORIES.EXECUTIVE ||
    profile.category === ROLE_CATEGORIES.MANAGEMENT;

  if (isGuestManagement && containsForbiddenExecutiveLanguage(text)) {
    return { ok: false, reason: "executive_waiter_phrase" };
  }
  if (isGuestManagement && containsConsultantLanguage(text)) {
    return { ok: false, reason: "consultant_language" };
  }
  if (containsAiPunctuation(text)) {
    return { ok: false, reason: "ai_punctuation" };
  }
  if (isManagementHonorificRole(role) && !managementHonorificPresent(text)) {
    return { ok: false, reason: "missing_management_honorific" };
  }
  return { ok: true };
}
