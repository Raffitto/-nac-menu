/**
 * Human behavioral simulation engine — all NAC review QR branches.
 */

import {
  canonName,
  withHonorificEN,
  withHonorificAR,
} from "./reviewGeneratorShared";
import {
  branchLabel,
  getBranchMenu,
  GENERIC_FOOD_EN,
  GENERIC_FOOD_AR,
  KHOBAR_MANAGERS,
} from "./reviewGeneratorMenus";

const NAC_TZ = "Asia/Riyadh";

const COOLDOWN_PHRASES = [
  "left impressed",
  "lovely service",
  "everything was excellent",
  "everything was on point",
  "genuinely enjoyable",
  "solid experience",
  "did not disappoint",
  "both were excellent",
  "great experience overall",
  "highly recommended",
  "will definitely come back",
  "stopped by",
  "visited nac",
  "thanks to",
  "we tried the",
  "from start to finish",
  "warm welcome",
  "attentive throughout",
];

const COOLDOWN_TURNS = 22;
const SIMILARITY_REJECT = 0.62;
const MAX_ATTEMPTS = 100;

const PERSONALITIES = [
  "casual_young",
  "foodie",
  "coffee_lover",
  "business_lunch",
  "family_visitor",
  "first_time",
  "regular",
  "short_attention",
  "emotional",
  "detail_oriented",
  "typo_heavy",
  "arabic_mixed",
  "minimalist",
];

const STRUCTURES = [
  "atmosphere_only",
  "food_only",
  "waiter_focus",
  "coffee_only",
  "dessert_only",
  "quick_line",
  "mixed_scatter",
  "story_long",
  "food_first",
  "service_first",
];

const POSITIVE_ADJECTIVES = [
  "excellent",
  "amazing",
  "lovely",
  "great",
  "perfect",
  "wonderful",
  "impressive",
  "delicious",
  "smooth",
  "attentive",
  "friendly",
  "cozy",
  "solid",
  "nice",
  "good",
];

const memoryStore = new Map();

function getStore() {
  if (typeof sessionStorage !== "undefined") {
    return {
      get(key) {
        try {
          return sessionStorage.getItem(key);
        } catch {
          return memoryStore.get(key) ?? null;
        }
      },
      set(key, val) {
        try {
          sessionStorage.setItem(key, val);
        } catch {
          memoryStore.set(key, val);
        }
      },
    };
  }
  return {
    get: (key) => memoryStore.get(key) ?? null,
    set: (key, val) => memoryStore.set(key, val),
  };
}

function r(n) {
  return Math.floor(Math.random() * n);
}
function pick(a) {
  return a[r(a.length)];
}
function chance(p) {
  return Math.random() < p;
}
function pick2(arr) {
  if (arr.length < 2) return [pick(arr)];
  let a = pick(arr);
  let b = pick(arr);
  let g = 0;
  while (b === a && g < 15) {
    b = pick(arr);
    g++;
  }
  return [a, b];
}

function getBranchHour(scanTime) {
  const d = scanTime instanceof Date ? scanTime : new Date(scanTime || Date.now());
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NAC_TZ,
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 12);
}

function resolveMealContext(hour) {
  if (hour < 12) {
    return {
      period: "breakfast",
      allowBreakfast: true,
      breakfastWeight: 0.55,
      mainWeight: 0.35,
      note: "before_noon_breakfast_ok",
    };
  }
  if (hour < 17) {
    return {
      period: "lunch",
      allowBreakfast: chance(0.08),
      breakfastWeight: 0.05,
      mainWeight: 0.85,
      note: "afternoon_main_priority",
    };
  }
  return {
    period: "dinner",
    allowBreakfast: false,
    breakfastWeight: 0,
    mainWeight: 0.92,
    note: "evening_no_breakfast",
  };
}

function pickFoodPool(menu, meal) {
  if (meal.allowBreakfast && chance(meal.breakfastWeight)) return menu.breakfast;
  return menu.main;
}

function isBreakfastItem(name) {
  const n = String(name).toLowerCase();
  return /egg|pancake|french toast|shakshuka|breakfast|avocado toast|halloumi|pastries|turkish eggs|mediterranean breakfast|mushroom toast|brunch/.test(
    n,
  );
}

function filterMealRealistic(items, meal) {
  if (meal.allowBreakfast) return items;
  return items.filter((it) => !isBreakfastItem(it));
}

function selectLengthClass() {
  const roll = Math.random();
  if (roll < 0.2) return "very_short";
  if (roll < 0.6) return "medium";
  if (roll < 0.9) return "detailed";
  return "long_story";
}

function selectPersonality() {
  return pick(PERSONALITIES);
}

function selectStructure(personality, lengthClass) {
  if (lengthClass === "very_short") {
    return pick(["quick_line", "waiter_focus", "coffee_only", "food_only"]);
  }
  if (lengthClass === "long_story") return "story_long";
  if (personality === "coffee_lover") return pick(["coffee_only", "mixed_scatter", "food_first"]);
  if (personality === "minimalist") return pick(["quick_line", "waiter_focus", "food_only"]);
  if (personality === "foodie") return pick(["food_first", "food_only", "mixed_scatter", "story_long"]);
  return pick(STRUCTURES);
}

function openingsFor(personality, branchId, isAr, meal) {
  const place = branchLabel(branchId, isAr);
  if (isAr) {
    const ar = [
      "صراحة تجربة حلوة.",
      "مكان مرتب والأجواء مريحة.",
      "جينا للقهوة وطلعنا مبسوطين.",
      "ما توقعت يكون بهالجودة.",
      `أحد أفضل أماكن ${place.includes("الخبر") ? "الخبر" : place.includes("جدة") ? "جدة" : "الرياض"} للفطور.`,
      "زيارة سريعة بس ممتازة.",
      "الجو هادي والمكان نظيف.",
      "جربنا المكان بناءً على توصية.",
    ];
    if (personality === "foodie") ar.push("الريزوتو كان شي ثاني.", "الفرنش توست يستاهل.");
    if (meal.period === "breakfast") ar.push("فطورنا هنا اليوم.", "المكان ممتاز للبرانش.");
    return ar;
  }

  const short = [...OPENINGS_SHORT_EN];
  const story = OPENINGS_STORY_EN(place);
  const food = [...OPENINGS_FOOD_EN];
  const casual = [...OPENINGS_CASUAL_EN];

  if (personality === "foodie") return meal.allowBreakfast ? food : food.filter((line) => !isBreakfastItem(line));
  if (personality === "coffee_lover") return ["Coffee was on point.", "Came for the flat white.", ...short];
  if (personality === "business_lunch") return ["Quick lunch stop.", "Needed a fast bite between meetings.", ...short];
  if (personality === "first_time") return story;
  if (personality === "regular") return ["Back again.", "Always reliable here.", ...casual];

  const pool = [...short, ...story, ...food, ...casual];
  if (meal.period === "breakfast") {
    pool.push(`One of the better brunch spots in ${place.replace("NAC ", "")}.`);
    pool.push("Came in for breakfast.");
  } else {
    return pool.filter((line) => !isBreakfastItem(line));
  }
  return pool;
}

const OPENINGS_SHORT_EN = [
  "Honestly surprised.",
  "Very nice experience today.",
  "Came for coffee, stayed for dessert.",
  "Didn't expect it to be this good.",
  "Good vibes honestly.",
  "Really liked the atmosphere.",
  "Coffee was on point.",
  "Nice spot.",
  "Solid visit.",
  "Worth it.",
];

function OPENINGS_STORY_EN(place) {
  return [
    "We were searching for a late breakfast place and ended up here.",
    "After gym we decided to try NAC.",
    "My friend recommended this place.",
    `First time at ${place} and glad we came.`,
    "Needed a quick bite and this worked out perfectly.",
    "Walked in without expectations and left happy.",
    "Was nearby and decided to stop in.",
  ];
}

const OPENINGS_FOOD_EN = [
  "The truffle risotto was amazing.",
  "That French toast deserves more attention.",
  "Sliders hit different here.",
  "The pasta was actually really good.",
  "Coffee alone is worth the visit.",
  "Burrata was the highlight.",
  "Steak came out perfect.",
];

const OPENINGS_CASUAL_EN = [
  "Good vibes honestly.",
  "Really liked the atmosphere.",
  "Coffee was on point.",
  "Chill place.",
  "Lowkey great.",
  "Pretty cozy.",
];

function staffDisplayName(staff, role, isAr) {
  const roleL = String(role || "").toLowerCase();
  if (roleL === "receptionist") {
    return isAr ? withHonorificAR(staff) : withHonorificEN(staff);
  }
  return staff;
}

function buildWaiterMention(staff, role, personality, isAr) {
  if (!staff || staff === "Team") {
    return isAr ? "الفريق كان متعاون." : "The team was helpful.";
  }
  const name = staffDisplayName(staff, role, isAr);
  const plain = staff;
  const honorEn = withHonorificEN(staff);
  const honorAr = withHonorificAR(staff);

  if (isAr) {
    const lines = [
      `${honorAr} كان منتبهاً.`,
      `${name} خلّى الزيارة أسهل.`,
      `شكراً ${honorAr} على الخدمة.`,
      `${name} تابع معنا بشكل ممتاز.`,
      `تعامل ${name} كان راقي.`,
      `مكان جميل والخدمة ممتازة شكراً لـ${honorAr}`,
      `${plain} كان لطيف جداً.`,
      `${name} ساعدنا من أول لحظة.`,
    ];
    return pick(lines);
  }

  const en = [
    `${plain} was very attentive.`,
    `${plain} was very attentive honestly`,
    `Thanks to ${honorEn} for the service.`,
    `${plain} made the experience smooth.`,
    `${honorEn} handled our table very professionally.`,
    `${plain} kept checking on us at the right time.`,
    `Shoutout to ${plain} — solid service.`,
    `${plain} was sweet.`,
    `Really appreciated ${plain} today.`,
    `${plain} took care of everything.`,
    `nice place for breakfast ${plain.toLowerCase()} was great`,
    `Loved the vibe. ${plain} was on it.`,
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

function buildFoodLine(menu, meal, personality, isAr, useGeneric) {
  if (useGeneric || chance(0.58)) {
    const g = isAr ? pick(GENERIC_FOOD_AR) : pick(GENERIC_FOOD_EN);
    const templates = isAr
      ? [`${g} كان ممتاز.`, `أحببنا ${g}.`, `${g} 👌`]
      : [`Loved the ${g}.`, `${g.charAt(0).toUpperCase() + g.slice(1)} was good.`, `${g} hit the spot.`];
    return pick(templates);
  }

  let pool = filterMealRealistic(pickFoodPool(menu, meal), meal);
  if (!pool.length) pool = menu.main;
  const item = pick(pool);
  const [a, b] = pick2(pool);

  if (personality === "foodie" && chance(0.4)) {
    return isAr
      ? `جربنا ${a} و ${b} — ممتازين.`
      : pick([
          `The ${a} was crazy good.`,
          `${a} and ${b} both slapped honestly.`,
          `Ordered ${a} with ${b} — no regrets.`,
        ]);
  }

  const templates = isAr
    ? [`${item} كان لذيذ.`, `أعجبنا ${item}.`, `طلبنا ${item} وكان مضبوط.`]
    : [
        `The ${item} was really good.`,
        `${item.charAt(0).toUpperCase() + item.slice(1)} surprised us.`,
        `Got the ${item} — worth it.`,
        `Sliders were crazy good lol`.replace("Sliders", item.includes("slider") ? "Sliders" : item),
      ];
  return pick(templates);
}

function buildCoffeeLine(menu, isAr) {
  const drinks = [...menu.hotDrinks, ...menu.icedDrinks];
  const d = pick(drinks.length ? drinks : menu.allDrinks);
  return isAr
    ? pick([`${d} ممتاز.`, `القهوة (${d}) كانت حلوة.`, `${d} 👌`])
    : pick([
        `The ${d} was perfect.`,
        `Iced americano situation was on point.`,
        `${d} — no notes.`,
        `Coffee (${d}) was great.`,
      ]);
}

function buildDessertLine(menu, isAr) {
  const d = pick(menu.desserts.length ? menu.desserts : ["dessert"]);
  return isAr ? `الحلى (${d}) كان لذيذ.` : pick([`Finished with ${d}.`, `Dessert (${d}) was nice.`, `${d} at the end 👌`]);
}

function buildAtmosphereLine(personality, isAr) {
  const en = [
    "Good vibes honestly.",
    "Really liked the atmosphere.",
    "Comfortable and clean.",
    "Chill mood, not too loud.",
    "Cozy spot.",
    "Nice interior.",
    "Relaxed setting.",
  ];
  const ar = ["الأجواء مريحة.", "المكان نظيف ومرتب.", "جو هادي.", "تصميم حلو."];
  if (personality === "minimalist") {
    return isAr ? pick(ar.slice(0, 2)) : pick(en.slice(0, 2));
  }
  return isAr ? pick(ar) : pick(en);
}

function buildClosing(personality, isAr) {
  const calmEn = ["Would come back.", "Glad we came.", "Solid.", "👍", "Nice one."];
  const excitedEn = ["Definitely coming back!", "Already planning the next visit.", "10/10 would repeat."];
  const calmAr = ["نرجع again.", "تجربة حلوة.", "👍", "يعطيكم العافية."];
  const excitedAr = ["أكيد نرجع!", "نرجع قريب إن شاء الله."];

  if (personality === "emotional" || personality === "foodie") {
    return isAr ? pick(excitedAr) : pick(excitedEn);
  }
  if (personality === "minimalist" || personality === "short_attention") {
    return isAr ? pick(calmAr.slice(0, 2)) : pick(calmEn.slice(0, 2));
  }
  return isAr ? pick([...calmAr, ...excitedAr]) : pick([...calmEn, ...excitedEn]);
}

function buildReceptionLine(staff, isAr) {
  const name = isAr ? withHonorificAR(staff) : withHonorificEN(staff);
  return isAr
    ? pick([
        `${name} رحبت فينا بحرارة.`,
        `${name} رتبت الجلوس بسرعة.`,
        `الاستقبال مع ${name} كان سلس.`,
      ])
    : pick([
        `${name} welcomed us warmly.`,
        `${name} got us seated quickly.`,
        `${name} handled check-in smoothly.`,
       ]);
}

function buildManagerSnippet(branchId) {
  if ((branchId || "khobar").toLowerCase() !== "khobar") return null;
  const m = pick(KHOBAR_MANAGERS);
  return pick([
    `${m} checked on our table.`,
    `${m} passed by to make sure everything was okay.`,
    `Appreciated the follow-up from ${m}.`,
    "One of the managers checked on us.",
  ]);
}

function shuffleParts(parts) {
  const out = [...parts];
  for (let i = out.length - 1; i > 0; i--) {
    const j = r(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function applyHumanImperfections(text, personality, isAr) {
  let out = text;
  if (isAr && personality === "arabic_mixed" && chance(0.55)) {
    return out;
  }
  if (!isAr && personality === "arabic_mixed" && chance(0.35)) {
    out = `${out} مكان جميل`;
  }
  if (personality === "typo_heavy" || personality === "casual_young") {
    if (chance(0.45)) out = out.charAt(0).toLowerCase() + out.slice(1);
    if (chance(0.2)) out = out.replace(/\./g, ",");
  }
  if (personality === "short_attention" && out.length > 120 && chance(0.5)) {
    const sentences = out.split(/(?<=[.!?])\s+/);
    out = sentences.slice(0, 2).join(" ");
  }
  if (chance(0.08) && !isAr) out = `${out} lol`;
  if (chance(0.06)) out = out.replace(/\.\s*$/, "");
  return out.replace(/\s+/g, " ").trim();
}

function normReview(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .trim();
}

function tokenSet(s) {
  return new Set(normReview(s).split(" ").filter((w) => w.length > 2));
}

function jaccardSimilarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
   return inter / (A.size + B.size - inter);
}

function openingKey(s) {
  return normReview(s).slice(0, 48);
}

function rhythmKey(s) {
  const sentences = String(s || "")
    .split(/[.!?]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return sentences.map((sent) => sent.split(/\s+/).filter(Boolean).length).join("-");
}

function getRecentMeta(key, limit = 40) {
  const store = getStore();
  try {
    const raw = store.get(key) || "[]";
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, limit) : [];
  } catch {
    return [];
  }
}

function pushRecentMeta(key, entry, limit) {
  const store = getStore();
  try {
    const arr = getRecentMeta(key, limit + 5);
    arr.unshift(entry);
    store.set(key, JSON.stringify(arr.slice(0, limit)));
  } catch {
    /* ignore */
  }
}

function getCooldowns() {
  const store = getStore();
  try {
    return JSON.parse(store.get("nac_review_phrase_cooldowns") || "{}");
  } catch {
    return {};
  }
}

function setCooldowns(map) {
  getStore().set("nac_review_phrase_cooldowns", JSON.stringify(map));
}

function tickCooldowns() {
  const cd = getCooldowns();
  for (const k of Object.keys(cd)) {
    cd[k] = Math.max(0, (cd[k] || 0) - 1);
    if (cd[k] <= 0) delete cd[k];
  }
  setCooldowns(cd);
}

function activateCooldowns(text) {
  const lower = normReview(text);
  const cd = getCooldowns();
  for (const phrase of COOLDOWN_PHRASES) {
    if (lower.includes(phrase)) cd[phrase] = COOLDOWN_TURNS;
  }
  setCooldowns(cd);
}

function blockedPhrasesIn(text) {
  const lower = normReview(text);
  const cd = getCooldowns();
  return COOLDOWN_PHRASES.filter((p) => cd[p] > 0 && lower.includes(p));
}

function adjectiveOverlap(text, recentTexts) {
  const lower = normReview(text);
  const used = POSITIVE_ADJECTIVES.filter((a) => lower.includes(a));
  if (!used.length) return 0;
  let hits = 0;
  for (const prev of recentTexts) {
    const pl = normReview(prev);
    if (used.some((a) => pl.includes(a))) hits++;
  }
  return hits / Math.max(recentTexts.length, 1);
}

function maxSimilarity(text, recent) {
  let max = 0;
  for (const prev of recent) {
    max = Math.max(max, jaccardSimilarity(text, prev.text || prev));
  }
  return max;
}

function staffNamePresent(text, staff) {
  if (!staff || staff === "Team") return true;
  return normReview(text).includes(staff.toLowerCase());
}

function ensureStaffMention(text, staff, role, personality, isAr) {
  if (staffNamePresent(text, staff)) return text;
  const mention = buildWaiterMention(staff, role, personality, isAr);
  const pos = r(3);
  if (pos === 0) return `${mention} ${text}`;
  if (pos === 1) {
    const mid = Math.floor(text.length / 2);
    const space = text.indexOf(" ", mid);
    if (space > 0) return `${text.slice(0, space)} ${mention} ${text.slice(space + 1)}`;
  }
  return `${text} ${mention}`;
}

function buildReviewDraft(ctx) {
  const {
    staff,
    role,
    branchId,
    isAr,
    personality,
    lengthClass,
    structure,
    menu,
    meal,
  } = ctx;

  const openerPool = openingsFor(personality, branchId, isAr, meal);
  const opener = pick(openerPool);
  const waiterLine = buildWaiterMention(staff, role, personality, isAr);
  const roleL = String(role || "").toLowerCase();

  const blocks = [];
  const includeFood = structure !== "atmosphere_only" && structure !== "coffee_only" && structure !== "waiter_focus" && structure !== "quick_line" && chance(lengthClass === "very_short" ? 0.35 : 0.72);
  const includeCoffee = structure === "coffee_only" || (personality === "coffee_lover" && chance(0.8)) || chance(0.28);
  const includeDessert = structure === "dessert_only" || (chance(0.22) && meal.period !== "breakfast");
  const includeAtmo = structure === "atmosphere_only" || structure === "story_long" || chance(0.38);
  const includeClose = lengthClass !== "very_short" || chance(0.35);

  if (structure === "food_first" && includeFood) {
    blocks.push(buildFoodLine(menu, meal, personality, isAr, false));
  }

  if (lengthClass !== "very_short" && structure !== "quick_line" && chance(0.82)) {
    blocks.push(opener);
  }

  if (structure === "service_first" || roleL === "receptionist") {
    if (roleL === "receptionist" && staff !== "Team") blocks.push(buildReceptionLine(staff, isAr));
    else blocks.push(waiterLine);
  }

  if (includeFood && structure !== "food_first") {
    blocks.push(buildFoodLine(menu, meal, personality, isAr, personality !== "foodie"));
  }
  if (includeCoffee) blocks.push(buildCoffeeLine(menu, isAr));
  if (includeDessert) blocks.push(buildDessertLine(menu, isAr));
  if (includeAtmo) blocks.push(buildAtmosphereLine(personality, isAr));

  if (structure !== "service_first" && roleL !== "receptionist") {
    blocks.push(waiterLine);
  }

  if (lengthClass === "long_story" && chance(0.45)) {
    blocks.push(
      isAr ? "التفاصيل كلها كانت مضبوطة." : pick(["Whole visit felt easy.", "Nothing felt rushed.", "Details were on point."]),
    );
  }

  if (chance(0.18)) {
    const mgr = buildManagerSnippet(branchId);
    if (mgr) blocks.push(mgr);
  }

  if (includeClose) blocks.push(buildClosing(personality, isAr));

  let ordered =
    structure === "mixed_scatter" || personality === "typo_heavy"
      ? shuffleParts(blocks.filter(Boolean))
      : blocks.filter(Boolean);

  if (lengthClass === "very_short") {
    ordered = shuffleParts([waiterLine, ...ordered.filter((b) => b !== waiterLine)]).slice(0, r(2) === 0 ? 2 : 3);
  }

  if (lengthClass === "long_story") {
    ordered = [opener, ...ordered.filter((b) => b !== opener)];
  }

  let text = ordered.join(" ");
  text = applyHumanImperfections(text, personality, isAr);
  text = ensureStaffMention(text, staff, role, personality, isAr);

  return { text, opener };
}

function validateReview(text, staff, recentGlobal, debug) {
  const blocked = blockedPhrasesIn(text);
  if (blocked.length) {
    debug.blockedPhrases = blocked;
    return { ok: false, reason: "cooldown", score: 1 };
  }

  const open = openingKey(text);
  const recentOpenings = recentGlobal.map((e) => e.opening).filter(Boolean);
  if (recentOpenings.includes(open)) {
    return { ok: false, reason: "opening", score: 0.9 };
  }

  const sim = maxSimilarity(
    text,
    recentGlobal.map((e) => e.text),
  );
  debug.similarityScore = sim;
  if (sim >= SIMILARITY_REJECT) {
    return { ok: false, reason: "similarity", score: sim };
  }

  const rhythm = rhythmKey(text);
  const recentRhythms = recentGlobal.map((e) => e.rhythm).filter(Boolean);
  if (recentRhythms.slice(0, 8).includes(rhythm)) {
    return { ok: false, reason: "rhythm", score: 0.75 };
  }

  const adj = adjectiveOverlap(
    text,
    recentGlobal.map((e) => e.text),
  );
  if (adj > 0.45) {
    return { ok: false, reason: "adjectives", score: adj };
  }

  if (!staffNamePresent(text, staff)) {
    return { ok: false, reason: "missing_staff", score: 1 };
  }

  return { ok: true, score: sim };
}

function publishDebug(debug) {
  if (typeof window !== "undefined") {
    window.__NAC_REVIEW_DIVERSITY_DEBUG__ = debug;
  }
}

/**
 * @param {{ staffName?: string, role?: string, branchId?: string, language?: string, scanTime?: Date|string|number }} opts
 */
export function generateHumanizedReview(opts = {}) {
  tickCooldowns();

  const branchId = (opts.branchId || "khobar").toLowerCase();
  const staff = canonName(opts.staffName);
  const role = String(opts.role || "team").toLowerCase().trim();
  const isAr = opts.language === "ar";
  const scanTime = opts.scanTime || new Date();
  const hour = getBranchHour(scanTime);
  const meal = resolveMealContext(hour);
  const menu = getBranchMenu(branchId);

  const globalKey = "nac_review_global_diversity";
  const recentGlobal = getRecentMeta(globalKey, 50);

  let best = null;
  let bestScore = 2;
  let lastDebug = {};

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const personality = selectPersonality();
    const lengthClass = selectLengthClass();
    const structure = selectStructure(personality, lengthClass);

    const debug = {
      personality,
      structureType: structure,
      lengthClass,
      mealLogic: meal,
      branchId,
      hour,
      attempt,
      blockedPhrases: [],
      similarityScore: 0,
    };

    const draft = buildReviewDraft({
      staff,
      role,
      branchId,
      isAr,
      personality,
      lengthClass,
      structure,
      menu,
      meal,
    });

    const validation = validateReview(draft.text, staff, recentGlobal, debug);
    debug.validation = validation.reason || "ok";
    lastDebug = debug;

    if (validation.ok) {
      const entry = {
        text: draft.text,
        opening: openingKey(draft.text),
        rhythm: rhythmKey(draft.text),
        branchId,
        ts: Date.now(),
      };
      pushRecentMeta(globalKey, entry, 50);
      activateCooldowns(draft.text);
      publishDebug({ ...debug, similarityScore: validation.score, finalText: draft.text });
      return draft.text;
    }

    if (validation.score < bestScore) {
      bestScore = validation.score;
      best = { text: draft.text, debug };
    }
  }

  const fallbackText = best?.text || ensureStaffMention(
    isAr ? "تجربة حلوة." : "Nice visit.",
    staff,
    role,
    "minimalist",
    isAr,
  );

  pushRecentMeta(globalKey, {
    text: fallbackText,
    opening: openingKey(fallbackText),
    rhythm: rhythmKey(fallbackText),
    branchId,
    ts: Date.now(),
  }, 50);
  activateCooldowns(fallbackText);

  publishDebug({
    ...lastDebug,
    fallback: true,
    similarityScore: bestScore,
    finalText: fallbackText,
  });

  return fallbackText;
}

/** Reset in-memory/session diversity state — for verification scripts */
export function resetReviewDiversityState() {
  memoryStore.clear();
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem("nac_review_global_diversity");
      sessionStorage.removeItem("nac_review_phrase_cooldowns");
    } catch {
      /* ignore */
    }
  }
}