/** Menu item classification for hospitality operational intelligence */

const LOW_VALUE_BEV = [
  "pepsi",
  "7up",
  "7 up",
  "cola",
  "coke",
  "sprite",
  "fanta",
  "soft drink",
  "soda",
  "still water",
  "sparkling water",
  "mineral water",
  "water bottle",
  "iced tea",
];

const PREMIUM_BEV = [
  "mocktail",
  "mojito",
  "lemonade",
  "signature",
  "specialty",
  "fresh juice",
  "smoothie",
  "frappe",
  "iced spanish",
  "spanish latte",
  "cold brew",
  "nitro",
];

const COFFEE = ["coffee", "espresso", "latte", "cappuccino", "americano", "macchiato", "flat white", "cortado"];

const BREAKFAST = [
  "breakfast",
  "pancake",
  "waffle",
  "french toast",
  "eggs",
  "egg ",
  "omelette",
  "omelet",
  "shakshuka",
  "avocado toast",
  "brunch",
  "granola",
  "croissant",
  "benedict",
];

const EGG = ["egg", "eggs", "omelette", "omelet", "shakshuka", "benedict"];

const DESSERT = ["dessert", "cake", "churros", "cheesecake", "brownie", "ice cream", "tiramisu", "kunafa"];

const PREMIUM_FOOD = ["truffle", "wagyu", "lobster", "premium", "signature"];

function norm(name) {
  return String(name || "").toLowerCase();
}

function matchesAny(name, list) {
  const n = norm(name);
  return list.some((k) => n.includes(k));
}

export function classifyMenuItem(name, category = "") {
  const n = norm(name);
  const cat = norm(category);

  if (matchesAny(n, LOW_VALUE_BEV) || (n.includes("water") && !n.includes("melon"))) {
    return { beverageTier: "low_value", foodTier: null, daypart: null };
  }
  if (matchesAny(n, PREMIUM_BEV)) {
    return { beverageTier: "premium", foodTier: null, daypart: "any" };
  }
  if (matchesAny(n, COFFEE) || cat === "beverage") {
    return { beverageTier: matchesAny(n, PREMIUM_BEV) ? "premium" : "standard", foodTier: null, daypart: null };
  }
  if (matchesAny(n, EGG)) {
    return { beverageTier: null, foodTier: "egg", daypart: "breakfast" };
  }
  if (matchesAny(n, BREAKFAST) || cat === "breakfast") {
    return { beverageTier: null, foodTier: "breakfast", daypart: "breakfast" };
  }
  if (matchesAny(n, DESSERT) || cat === "dessert") {
    return { beverageTier: null, foodTier: "dessert", daypart: "pm" };
  }
  if (matchesAny(n, PREMIUM_FOOD)) {
    return { beverageTier: null, foodTier: "premium", daypart: null };
  }
  return { beverageTier: null, foodTier: "standard", daypart: null };
}

/** Known shift tendencies — used when data is ambiguous */
export const STAFF_SHIFT_HINTS = {
  Azhar: "breakfast",
  "Abu Sofian": "balanced",
  Saiful: "balanced",
  Ronald: "pm",
  Rana: "pm",
  Sujan: "balanced",
};

export function inferShiftLean(waiterName, metrics) {
  const hint = STAFF_SHIFT_HINTS[waiterName];
  if (hint) return hint;
  if (metrics.breakfastPct >= 38) return "breakfast";
  if (metrics.dessertPct >= 14 && metrics.breakfastPct < 22) return "pm";
  return "balanced";
}
