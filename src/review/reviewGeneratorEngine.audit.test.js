/**
 * Full verification & anti-pattern audit for review generation engine.
 * Run: CI=true npm test -- --testPathPattern=reviewGeneratorEngine.audit --watchAll=false
 */

import {
  generateHumanizedReview,
  resetReviewDiversityState,
} from "./reviewGeneratorEngine";
import { getBranchMenu, GENERIC_FOOD_EN, GENERIC_FOOD_AR } from "./reviewGeneratorMenus";

const BRANCHES = ["khobar", "riyadh", "jeddah"];
const STAFF = ["Ronald", "Azhar", "Rana", "Mohamed", "Boyboy", "Angel", "Fady"];
const ROLES = ["waiter", "receptionist", "supervisor"];
const TIME_WINDOWS = [
  { label: "breakfast", hour: 9 },
  { label: "lunch", hour: 14 },
  { label: "dinner", hour: 20 },
  { label: "night", hour: 22 },
];

const DEPRECATED_ITEMS = [
  "cajun chicken",
  "truffle corn risotto",
  "rigatoni pasta with chicken sumac",
  "oven baked mac",
];

const COFFEE_DESSERT_RE = /\b(coffee|cappuccino|latte|espresso|flat white|dessert|churros|pavlova|affogato|cookies|mocha|macchiato|iced latte|قهوة|حلى|كابتشينو|لاتيه)\b/i;
const MAIN_FOOD_RE = /\b(steak|risotto|burger|sliders|pasta|rigatoni|burrata|chicken|prawn|salad|popcorn|sumac|asparagus|hummus|aubergine|mains|sharing|truffle|angus|halloumi|eggs|shakshuka|toast|pancake|فطور|برانش|بيض|أطباق|ستيك|ريزوتو|برجر|باستا|دجاج|بوراتا|سلطة|سلايدر)\b/i;
const BREAKFAST_RE = /\b(eggs florentine|french toast|pancakes|shakshuka|avocado toast|scrambled eggs|poached eggs|turkish eggs|mediterranean breakfast|pastries basket|halloumi|breakfast tea|البيض|فطور|فرنش توست|بانكيك)\b/i;

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function openingOf(text) {
  const first = String(text).split(/[.!?؟]/)[0]?.trim() || "";
  return norm(first).slice(0, 55);
}

function endingOf(text) {
  const parts = String(text).split(/[.!?؟]/).map((x) => x.trim()).filter(Boolean);
  return norm(parts[parts.length - 1] || "").slice(0, 55);
}

function rhythmOf(text) {
  return String(text)
    .split(/[.!?؟]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/).length)
    .join("-");
}

function skeletonOf(text) {
  return norm(text)
    .replace(/\b(mr|miss|مس|مستر)\s+\w+/g, "{STAFF}")
    .replace(/\b(ronald|azhar|rana|mohamed|boyboy|angel|fady|bashar|raffi)\b/g, "{STAFF}")
    .replace(/\b[\w']{4,}\b/g, (w) => {
      if (/^\d/.test(w)) return w;
      return "{w}";
    });
}

function countStaffMentions(text, staff) {
  if (!staff || staff === "Team") return 1;
  const re = new RegExp(staff.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return (text.match(re) || []).length;
}

function extractMenuTokens(branchId) {
  const menu = getBranchMenu(branchId);
  const all = [
    ...menu.allFoods,
    ...menu.allDrinks,
    ...(menu.legacyFoods || []).flatMap((f) => [f.en, f.ar]),
    ...(menu.legacyDrinks || []).flatMap((d) => [d.en, d.ar]),
  ];
  return all.map((x) => norm(x));
}

function isDeprecatedMention(text) {
  const lower = norm(text);
  return DEPRECATED_ITEMS.some((d) => lower.includes(norm(d)));
}

function classifyFocus(text) {
  const coffeeDessert = COFFEE_DESSERT_RE.test(text);
  const main = MAIN_FOOD_RE.test(text);
  if (coffeeDessert && !main) return "drink_dessert_primary";
  if (main) return coffeeDessert ? "mixed" : "food_primary";
  if (coffeeDessert) return "drink_dessert_primary";
  return "neutral";
}

function dinnerHasFood(text, branchId) {
  const menu = getBranchMenu(branchId);
  const lower = norm(text);
  for (const item of menu.main) {
    if (lower.includes(norm(item))) return true;
  }
  return MAIN_FOOD_RE.test(text);
}

function jaccard(a, b) {
  const A = new Set(norm(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(norm(b).split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function generateBatch(language, count) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    const branch = BRANCHES[i % BRANCHES.length];
    const staff = STAFF[i % STAFF.length];
    const role = ROLES[i % ROLES.length];
    const tw = TIME_WINDOWS[i % TIME_WINDOWS.length];
    const scanTime = new Date(`2026-05-24T${String(tw.hour).padStart(2, "0")}:15:00+03:00`);
    const text = generateHumanizedReview({
      staffName: staff,
      role,
      branchId: branch,
      language,
      scanTime,
    });
    samples.push({
      language,
      branch,
      staff,
      role,
      period: tw.label,
      hour: tw.hour,
      text,
      debug: globalThis.__NAC_REVIEW_DIVERSITY_DEBUG__ || {},
    });
  }
  return samples;
}

function analyzeSamples(samples) {
  const openings = {};
  const endings = {};
  const rhythms = {};
  const skeletons = {};
  const adjPairs = {};
  const emojiPatterns = {};

  let waiterOk = 0;
  let waiterDup = 0;
  let waiterMissing = 0;
  let deprecatedHits = 0;
  let dinnerDrinkPrimary = 0;
  let dinnerFoodPrimary = 0;
  let dinnerTotal = 0;
  let breakfastOk = 0;
  let breakfastTotal = 0;
  let nightBreakfastHits = 0;
  let arEnglishMirror = 0;
  let arTotal = 0;

  const menuTokensByBranch = Object.fromEntries(BRANCHES.map((b) => [b, extractMenuTokens(b)]));

  for (const s of samples) {
    const op = openingOf(s.text);
    const en = endingOf(s.text);
    const rh = rhythmOf(s.text);
    const sk = skeletonOf(s.text);

    openings[op] = (openings[op] || 0) + 1;
    endings[en] = (endings[en] || 0) + 1;
    rhythms[rh] = (rhythms[rh] || 0) + 1;
    skeletons[sk] = (skeletons[sk] || 0) + 1;

    const em = (s.text.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).join("");
    if (em) emojiPatterns[em] = (emojiPatterns[em] || 0) + 1;

    const mentions = countStaffMentions(s.text, s.staff);
    if (mentions === 0) waiterMissing++;
    else if (mentions > 2) waiterDup++;
    else waiterOk++;

    if (isDeprecatedMention(s.text)) deprecatedHits++;

    if (s.period === "dinner" || s.period === "night") {
      dinnerTotal++;
      const focus = classifyFocus(s.text);
      const hasFood = dinnerHasFood(s.text, s.branch);
      if (focus === "drink_dessert_primary") dinnerDrinkPrimary++;
      if (hasFood || focus === "food_primary" || focus === "mixed") dinnerFoodPrimary++;
      if (BREAKFAST_RE.test(s.text)) nightBreakfastHits++;
    }

    if (s.period === "breakfast") {
      breakfastTotal++;
      if (BREAKFAST_RE.test(s.text) || /breakfast|brunch|فطور|برانش|الفطور/i.test(s.text)) breakfastOk++;
    }

    if (s.language === "ar") {
      arTotal++;
      if (/was very attentive|thanks to|made the experience|hit the spot|would come back/i.test(s.text)) {
        arEnglishMirror++;
      }
    }
  }

  // pairwise similarity (sample subset for speed)
  let highSimPairs = 0;
  let comparisons = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < Math.min(i + 15, samples.length); j++) {
      comparisons++;
      if (jaccard(samples[i].text, samples[j].text) >= 0.55) highSimPairs++;
    }
  }

  const topOpenings = Object.entries(openings).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topSkeletons = Object.entries(skeletons).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topRhythms = Object.entries(rhythms).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const uniqueOpenings = Object.keys(openings).length;
  const uniqueSkeletons = Object.keys(skeletons).length;
  const phraseCollisions = Object.values(openings).filter((c) => c > 2).length
    + Object.values(skeletons).filter((c) => c > 3).length;

  const uniquenessScore = Math.round((uniqueOpenings / samples.length) * 100);
  const structureDiversity = Math.round((uniqueSkeletons / samples.length) * 100);
  const phraseCollisionRate = Math.round((phraseCollisions / samples.length) * 100);
  const waiterSuccess = Math.round((waiterOk / samples.length) * 100);
  const dinnerFoodFirstPct = dinnerTotal ? Math.round((dinnerFoodPrimary / dinnerTotal) * 100) : 100;
  const breakfastRealismPct = breakfastTotal ? Math.round((breakfastOk / breakfastTotal) * 100) : 100;
  const googleRisk = Math.min(
    100,
    Math.round(
      (topOpenings[0]?.[1] || 0) * 3 +
        (topSkeletons[0]?.[1] || 0) * 4 +
        highSimPairs * 2 +
        phraseCollisions,
    ),
  );

  return {
    total: samples.length,
    uniquenessScore,
    structureDiversity,
    phraseCollisionRate,
    waiterSuccess,
    waiterMissing,
    waiterDup,
    dinnerFoodFirstPct,
    dinnerDrinkPrimary,
    dinnerTotal,
    breakfastRealismPct,
    nightBreakfastHits,
    deprecatedHits,
    arEnglishMirror,
    arTotal,
    highSimPairs,
    comparisons,
    googleRiskEstimate: googleRisk,
    topOpenings,
    topSkeletons,
    topRhythms,
    topEndings: Object.entries(endings).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}

describe("review engine full audit", () => {
  beforeAll(() => {
    resetReviewDiversityState();
  });

  it("passes massive sample audit (100 EN + 100 AR)", () => {
    resetReviewDiversityState();
    const en = generateBatch("en", 100);
    const ar = generateBatch("ar", 100);
    const all = [...en, ...ar];

    const report = analyzeSamples(all);

    // eslint-disable-next-line no-console
    console.log("\n========== NAC REVIEW ENGINE AUDIT REPORT ==========");
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log("====================================================\n");

    expect(all.length).toBe(200);
    expect(report.waiterMissing).toBe(0);
    expect(report.waiterSuccess).toBeGreaterThanOrEqual(95);
    expect(report.uniquenessScore).toBeGreaterThanOrEqual(65);
    expect(report.structureDiversity).toBeGreaterThanOrEqual(55);
    expect(report.dinnerFoodFirstPct).toBeGreaterThanOrEqual(70);
    expect(report.breakfastRealismPct).toBeGreaterThanOrEqual(55);
    expect(report.dinnerDrinkPrimary / Math.max(report.dinnerTotal, 1)).toBeLessThanOrEqual(0.2);
    expect(report.nightBreakfastHits).toBeLessThanOrEqual(3);
    expect(report.deprecatedHits).toBe(0);
    expect(report.googleRiskEstimate).toBeLessThan(40);
    expect(report.arEnglishMirror / Math.max(report.arTotal, 1)).toBeLessThanOrEqual(0.05);
  });
});
