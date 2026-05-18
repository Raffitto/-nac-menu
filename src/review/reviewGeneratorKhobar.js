/**
 * Premium Khobar review generator — only real NAC Khobar menu items.
 */

import { canonName, withHonorificEN, withHonorificAR } from "./reviewGeneratorShared";

const KHOBAR_MANAGERS = ["Fady", "Raffi", "Bashar"];

const FOODS_BREAKFAST = [
  "avocado toast",
  "poached eggs avocado",
  "scrambled eggs",
  "shakshuka",
  "Turkish eggs",
  "Mediterranean breakfast",
  "pancakes",
  "French toast",
  "pastries basket",
  "2 eggs breakfast",
  "eggs florentine",
  "mushroom toast",
  "halloumi",
  "halloumi fries",
  "spicy fried egg",
];

const FOODS_MAIN = [
  "popcorn chicken",
  "chicken sliders",
  "sliders",
  "rigatoni pink sauce",
  "rigatoni pink sauce with chicken",
  "rigatoni pink sauce with prawn",
  "truffle risotto",
  "truffle risotto with chicken",
  "truffle risotto with prawn",
  "truffle burger",
  "black Angus steak",
  "smoked paprika prawn",
  "burrata",
  "crushed burrata",
  "kale cabbage salad",
  "quinoa salad",
  "house salad",
  "sumac chicken",
  "asparagus",
  "truffled mac and cheese",
  "beetroot hummus",
  "flamed aubergine",
  "frites",
  "olives",
  "honey sweet potato",
];

const DESSERTS = ["churros", "pavlova", "affogato", "cookies"];

const HOT_DRINKS = [
  "flat white",
  "cappuccino",
  "cortado",
  "latte",
  "Spanish latte",
  "mocha",
  "espresso",
  "double espresso",
  "macchiato",
  "breakfast tea",
  "jasmine tea",
  "hot chocolate",
];

const ICED_DRINKS = [
  "iced latte",
  "iced Spanish latte",
  "coconut iced latte",
  "iced mocha",
  "toasted banana iced latte",
  "jasmine iced tea",
];

const LEMONADES = [
  "basil lemonade",
  "passion fruit lemonade",
  "still homemade lemonade",
  "sparkling homemade lemonade",
  "orange pineapple",
  "raspberry mojito",
  "strawberry mojito",
  "passion fruit mojito",
  "classic mojito",
  "watermelon mint lemon",
  "apple lemon lime mint",
  "blackberry vanilla lemon",
  "pineapple rosemary mint",
  "lemon kumquat rosemary",
  "mango cardamom basil",
];

const ALL_FOODS = [...FOODS_BREAKFAST, ...FOODS_MAIN, ...DESSERTS];
const ALL_DRINKS = [...HOT_DRINKS, ...ICED_DRINKS, ...LEMONADES];

const EMOJIS = ["✨", "❤️", "☕️", "🙌", "🔥", "😍", "🍝", "✅"];

const OPENERS = [
  "Had a lovely time at NAC Khobar today.",
  "Stopped by NAC Khobar and left impressed.",
  "Our visit to NAC Khobar was genuinely enjoyable.",
  "NAC Khobar delivered a solid experience from start to finish.",
  "Really enjoyed our meal at NAC Khobar.",
  "Came in for brunch at NAC Khobar and it did not disappoint.",
  "Dinner at NAC Khobar felt effortless and well run.",
  "NAC Khobar has a great rhythm — calm, polished, and welcoming.",
];

const ATMOSPHERE = [
  "Cozy atmosphere and a relaxed mood.",
  "Elegant place with a premium feel.",
  "Calm environment and beautiful interior.",
  "Comfortable seating and a welcoming atmosphere.",
  "Lively but still organized — easy to enjoy.",
  "The vibe was warm without being loud.",
  "Beautiful interior and a comfortable flow.",
];

const ENDINGS = [
  "Will definitely come back.",
  "Looking forward to visiting again.",
  "Easily one of our favorite places in Khobar.",
  "Great experience overall.",
  "Keep up the amazing work.",
  "Definitely worth visiting.",
  "We'll be back soon.",
  "Thank you for the hospitality.",
];

const REC_LINES_EN = (name) => [
  `${name} welcomed us warmly.`,
  `${name} handled the seating professionally.`,
  `Big thanks to ${name} for organizing everything smoothly.`,
  `${name} made check-in and seating feel easy.`,
  `${name} greeted us with a smile and kept the flow smooth.`,
  `${name} was lovely at reception and got us seated quickly.`,
  `${name} handled reservations and seating really well.`,
];

const REC_LINES_AR = (name) => [
  `${name} رحبت فينا بحرارة.`,
  `${name} رتبت الجلوس بشكل ممتاز.`,
  `شكراً لـ ${name} على التنظيم السلس.`,
  `${name} سهلت علينا الدخول والجلوس.`,
  `${name} كانت لطيفة في الاستقبال وكل شيء كان مرتب.`,
];

const WAITER_LINES_EN = (name) => [
  `${name} was attentive throughout the meal.`,
  `${name} kept everything moving smoothly.`,
  `Thanks to ${name} for the friendly service.`,
  `${name} checked on us at the right moments.`,
];

const WAITER_LINES_AR = (name) => [
  `${name} كان منتبهاً طوال الوجبة.`,
  `${name} حافظ على سير الخدمة بسلاسة.`,
  `شكراً لـ ${name} على الخدمة اللطيفة.`,
  `${name} تابع معنا في الوقت المناسب.`,
];

const MANAGER_LINES = [
  (m) => `${m} checked on our table.`,
  (m) => `${m} passed by to make sure everything was okay.`,
  (m) => `${m} followed up during the meal.`,
  () => "One of the managers checked on us.",
  () => "The floor manager made sure we were comfortable.",
  () => "Nice touch that management asked about our experience.",
  (m) => `Appreciated the follow-up from ${m}.`,
  (m) => `${m} was attentive and professional.`,
  (m) => `${m} made sure the experience stayed smooth.`,
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

function emojiSuffix() {
  const roll = Math.random();
  if (roll < 0.45) return "";
  if (roll < 0.78) return ` ${pick(EMOJIS)}`;
  return ` ${pick(EMOJIS)}${pick(EMOJIS)}`;
}

function foodPhrase(items, isAr) {
  const [a, b] = pick2(items);
  const templates = isAr
    ? [
        `جربنا ${a} و ${b} وكانوا ممتازين.`,
        `أعجبنا ${a} كثيراً، وكذلك ${b}.`,
        `الطلب كان ${a} مع ${b} وكل شيء كان مضبوط.`,
      ]
    : [
        `We tried the ${a} and the ${b}, both were excellent.`,
        `Loved the ${a}, and the ${b} was just as good.`,
        `Ordered ${a} along with ${b} — everything hit the spot.`,
        `The ${a} was a highlight, and ${b} rounded out the meal nicely.`,
      ];
  return pick(templates);
}

function drinkPhrase(drinks, isAr) {
  const d = pick(drinks);
  const templates = isAr
    ? [
        `والـ ${d} كان رائع.`,
        `كذلك ${d} كان ممتاز.`,
        `مع ${d} كانت التجربة أحلى.`,
      ]
    : [
        `The ${d} was excellent too.`,
        `Also had a ${d} and it was perfect.`,
        `Pairing it with ${d} made the visit even better.`,
      ];
  return pick(templates);
}

function dessertPhrase(isAr) {
  const d = pick(DESSERTS);
  return isAr
    ? `والحلى (${d}) كان لذيذ جداً.`
    : `Finished with ${d} and it was delicious.`;
}

function managerSnippet() {
  const m = pick(KHOBAR_MANAGERS);
  const fn = pick(MANAGER_LINES);
  return fn(m);
}

function staffHonorific(staff, role, isAr) {
  const roleL = String(role || "").toLowerCase();
  if (roleL === "receptionist") {
    return isAr ? withHonorificAR(staff) : withHonorificEN(staff);
  }
  return isAr ? staff : staff;
}

function receptionistBlock(staff, isAr) {
  const name = staffHonorific(staff, "receptionist", isAr);
  return pick(isAr ? REC_LINES_AR(name) : REC_LINES_EN(name));
}

function buildKhobarReview(staff, roleRaw, isAr) {
  const role = String(roleRaw || "team").toLowerCase().trim();
  const lengthRoll = Math.random();
  const veryShort = lengthRoll < 0.28;
  const detailed = lengthRoll > 0.82;
  const focus = pick([
    "reception",
    "food",
    "coffee",
    "dessert",
    "atmosphere",
    "dinner",
    "brunch",
    "drinks",
    "management",
  ]);

  const parts = [];
  const name = staffHonorific(staff, role, isAr);

  if (veryShort) {
    parts.push(pick(isAr ? ["تجربة ممتازة.", "زيارة جميلة.", "خدمة رائعة."] : ["Great visit.", "Lovely experience.", "Excellent service."]));
    if (role === "receptionist") parts.push(receptionistBlock(staff, isAr));
    else if (staff !== "Team") {
      parts.push(pick(isAr ? WAITER_LINES_AR(name) : WAITER_LINES_EN(name)));
    }
    if (chance(0.4)) parts.push(foodPhrase(ALL_FOODS, isAr));
    parts.push(pick(ENDINGS));
    return parts.join(" ") + emojiSuffix();
  }

  parts.push(pick(OPENERS));

  if (focus === "reception" || role === "receptionist") {
    parts.push(receptionistBlock(staff, isAr));
    if (chance(0.5)) {
      parts.push(
        pick(
          isAr
            ? ["الجلوس كان سريع ومنظم.", "الاستقبال كان احترافي.", "كل شيء كان مرتب من أول لحظة."]
            : [
                "Seating was quick and well organized.",
                "The welcome felt genuinely warm.",
                "Everything felt smooth from arrival to the table.",
              ],
        ),
      );
    }
  } else if (staff !== "Team") {
    parts.push(
      pick(isAr ? WAITER_LINES_AR(name) : WAITER_LINES_EN(name)),
    );
  }

  if (focus === "food" || focus === "dinner" || focus === "brunch") {
    parts.push(foodPhrase(pick([FOODS_MAIN, FOODS_BREAKFAST, ALL_FOODS]), isAr));
    if (chance(0.45)) parts.push(drinkPhrase(ALL_DRINKS, isAr));
  } else if (focus === "coffee") {
    parts.push(drinkPhrase(HOT_DRINKS, isAr));
    if (chance(0.35)) parts.push(foodPhrase([...FOODS_BREAKFAST, ...FOODS_MAIN], isAr));
  } else if (focus === "dessert") {
    parts.push(dessertPhrase(isAr));
    if (chance(0.4)) parts.push(drinkPhrase(HOT_DRINKS, isAr));
  } else if (focus === "drinks") {
    parts.push(drinkPhrase(LEMONADES, isAr));
    if (chance(0.4)) parts.push(drinkPhrase(ICED_DRINKS, isAr));
  } else {
    if (chance(0.75)) parts.push(foodPhrase(ALL_FOODS, isAr));
    if (chance(0.5)) parts.push(drinkPhrase(ALL_DRINKS, isAr));
  }

  if (chance(0.55)) parts.push(pick(ATMOSPHERE));

  if (chance(0.4) && focus !== "management") parts.push(dessertPhrase(isAr));

  if (chance(0.4)) parts.push(managerSnippet()); /* ~40% manager mention */

  if (detailed) {
    parts.push(
      pick(
        isAr
          ? ["التجربة كانت متكاملة من الاستقبال للأكل.", "كل التفاصيل كانت مضبوطة."]
          : [
              "From greeting to dessert, everything felt thoughtful.",
              "The whole visit felt coordinated and relaxed.",
            ],
      ),
    );
  }

  parts.push(pick(ENDINGS));

  let out = parts.join(" ");
  if (!isAr && chance(0.12)) {
    out = out.replace(/really good/g, "honestly really good");
  }
  return out + emojiSuffix();
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

function getRecent(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function pushRecent(key, val, limit) {
  try {
    const arr = getRecent(key);
    arr.unshift(val);
    sessionStorage.setItem(key, JSON.stringify(arr.slice(0, limit)));
  } catch {
    /* ignore */
  }
}

export function generateKhobarReview(opts = {}) {
  const staff = canonName(opts.staffName);
  const role = String(opts.role || "team").toLowerCase();
  const isAr = opts.language === "ar";
  const langKey = isAr ? "ar" : "en";

  const globalKey = `nac_khobar_recent_${langKey}`;
  const staffKey = `nac_khobar_staff_${langKey}_${staff.toLowerCase()}`;
  const globalRecent = getRecent(globalKey);
  const staffRecent = getRecent(staffKey);

  let best = "";
  let bestScore = -1;

  for (let i = 0; i < 100; i++) {
    const txt = buildKhobarReview(staff, role, isAr).replace(/\s+/g, " ").trim();
    const hash = fnv1a(normReview(txt));
    const dupG = globalRecent.includes(hash);
    const dupS = staffRecent.includes(hash);
    if (!dupG && !dupS) {
      pushRecent(globalKey, hash, 30);
      pushRecent(staffKey, hash, 12);
      return txt;
    }
    const score = (dupG ? 0 : 1) + (dupS ? 0 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = txt;
    }
  }

  if (best) {
    const hash = fnv1a(normReview(best));
    pushRecent(globalKey, hash, 30);
    pushRecent(staffKey, hash, 12);
    return best;
  }

  return isAr
    ? `تجربة جميلة في NAC الخبر. شكراً للفريق.`
    : `Lovely experience at NAC Khobar. Thank you to the team.`;
}
