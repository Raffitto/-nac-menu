import { normalizeFoodicsName } from "../utils/foodicsNameNormalize";

/**
 * Management-report tracked upsell set.
 * Display names are the August reference PDF labels. Matching is exact
 * normalized keys and required-token rules — never loose single-token includes.
 */
export const TRACKED_UPSELL_ITEMS = [
  { id: "water", displayName: "Water", matchKeys: ["water", "still water"], forbidden: ["sparkling", "tonic", "coconut", "melon"] },
  { id: "sparkling_water_big", displayName: "Sparkling Water - Big", matchKeys: ["sparkling water big", "sparkling water large", "large sparkling water", "sparkling water"], forbidden: ["small", "sm"] },
  { id: "sparkling_water_small", displayName: "Sparkling Water - Small", matchKeys: ["sparkling water small", "sparkling water sm", "small sparkling water", "sparkling water-sm"] },
  { id: "paprika_prawn", displayName: "Paprika Prawn", matchKeys: ["paprika prawn", "smoked paprika prawn"] },
  { id: "sumac_chicken", displayName: "Sumac Chicken", matchKeys: ["sumac chicken"] },
  { id: "halloumi_grilled", displayName: "Halloumi Grilled", matchKeys: ["halloumi grilled", "grilled halloumi"], forbidden: ["fries", "fry"] },
  { id: "mac_cheese", displayName: "Mac & Cheese", matchKeys: ["mac cheese", "mac & cheese", "truffled mac cheese", "truffled mac & cheese"] },
  { id: "truffle_risotto", displayName: "Truffle Risotto", matchKeys: ["truffle risotto", "corn white truffle risotto", "corn & white truffle risotto"] },
  { id: "steak", displayName: "Steak", matchKeys: ["steak", "black angus steak au poivre"], forbidden: ["sandwich", "tartare"] },
  {
    id: "vanilla_mocktail",
    displayName: "Vanilla Mocktail",
    matchKeys: ["vanilla mocktail"],
    aliases: ["Blackberry & Vanilla, Lemon"],
    exactOnly: true,
  },
  { id: "extra_shot", displayName: "Extra Shot", matchKeys: ["extra shot"] },
  { id: "extra_patty", displayName: "Extra Patty", matchKeys: ["extra patty"] },
  {
    id: "mocktail_apple",
    displayName: "Mocktail - Apple & Lemon, Lime, Mint",
    matchKeys: ["apple lemon lime mint", "apple lemon lime & mint", "mocktail apple lemon lime mint"],
    required: ["apple", "lemon", "lime", "mint"],
    forbidden: ["mojito", "orange", "watermelon"],
  },
  {
    id: "mocktail_kumquat",
    displayName: "Mocktail - Kumquat, Rosemary & Lemon",
    matchKeys: ["kumquat rosemary lemon", "kumquat & rosemary & lemon"],
    required: ["kumquat", "rosemary"],
  },
  {
    id: "mocktail_mango",
    displayName: "Mocktail - Mango & Cardamon, Basil",
    matchKeys: ["mango cardamon basil", "mango cardamom basil", "mango cardamon & basil"],
    required: ["mango", "basil"],
    forbidden: ["mojito"],
  },
  {
    id: "mocktail_orange",
    displayName: "Mocktail - Orange & Pineapple, Almond",
    matchKeys: ["orange pineapple almond", "orange pineapple almond lime"],
    required: ["orange", "pineapple", "almond"],
  },
  {
    id: "mocktail_pineapple_rosemary",
    displayName: "Mocktail - Pineapple & Rosemary, Mint",
    matchKeys: ["pineapple rosemary mint", "pineapple & rosemary mint"],
    required: ["pineapple", "rosemary", "mint"],
    forbidden: ["orange"],
  },
  {
    id: "mocktail_watermelon",
    displayName: "Mocktail - Watermelon & Mint, Lemon",
    matchKeys: ["watermelon mint lemon", "watermelon mint & lemon"],
    required: ["watermelon", "mint"],
    forbidden: ["feta", "salad"],
  },
  {
    id: "mocktail_classic_mojito",
    displayName: "Mocktail - Classic Mojito",
    matchKeys: ["classic mojito", "virgin mojito"],
    forbidden: ["passion", "raspberry", "strawberry"],
  },
  {
    id: "mocktail_passion_mojito",
    displayName: "Mocktail - Passionfruit Mojito",
    matchKeys: ["passionfruit mojito", "passion fruit mojito", "virgin passion fruit mojito"],
    required: ["passion", "mojito"],
  },
  {
    id: "mocktail_raspberry_mojito",
    displayName: "Mocktail - Raspberry Mojito",
    matchKeys: ["raspberry mojito", "virgin raspberry mojito"],
    required: ["raspberry", "mojito"],
  },
  {
    id: "mocktail_strawberry_mojito",
    displayName: "Mocktail - Strawberry Mojito",
    matchKeys: ["strawberry mojito", "virgin strawberry mojito"],
    required: ["strawberry", "mojito"],
  },
  { id: "morel_pasta", displayName: "Morel Pasta, Parmesan", matchKeys: ["morel pasta parmesan", "morel pasta"], newMenu: true },
  { id: "king_prawn_rendang", displayName: "King Prawn Rendang", matchKeys: ["king prawn rendang", "prawn rendang"], newMenu: true },
  {
    id: "big_nac_new",
    displayName: "Big NAC New",
    matchKeys: ["big nac new"],
    exactOnly: true,
    newMenu: true,
  },
  { id: "chocolate_brownie", displayName: "Chocolate Brownie", matchKeys: ["chocolate brownie"], forbidden: ["sauce"], newMenu: true },
  {
    id: "sea_bass_creole",
    displayName: "Sea Bass Creole",
    matchKeys: ["sea bass creole"],
    aliases: ["Sea Bass Creaole"],
    exactOnly: true,
    newMenu: true,
  },
  {
    id: "watermelon_feta",
    displayName: "Watermelon & Feta Salad",
    matchKeys: ["watermelon feta salad", "watermelon & feta salad", "watermelon and feta salad"],
    required: ["watermelon", "feta"],
    forbidden: ["mint", "mocktail"],
    newMenu: true,
  },
];

export const NEW_MENU_TARGET_LABELS = [
  "Morel Pasta",
  "King Prawn Rendang",
  "Big NAC New",
  "Chocolate Brownie",
  "Sea Bass Creole",
  "Watermelon & Feta Salad",
];

function normKey(name) {
  return normalizeFoodicsName(String(name || "").replace(/,/g, " "));
}

function itemExactKeys(item) {
  return [...new Set([
    item.displayName,
    ...(item.matchKeys || []),
    ...(item.aliases || []),
  ].map(normKey).filter(Boolean))];
}

function hasForbidden(key, forbidden = []) {
  return (forbidden || []).some((token) => {
    const t = normKey(token);
    return t && key.split(" ").includes(t);
  });
}

function hasRequired(key, required = []) {
  if (!required?.length) return false;
  const parts = key.split(" ").filter(Boolean);
  return required.every((token) => {
    const t = normKey(token);
    return parts.some((p) => p === t || (t.length >= 4 && p.startsWith(t)) || (p.length >= 4 && t.startsWith(p)));
  });
}

function matchesExact(item, key) {
  return itemExactKeys(item).includes(key) && !hasForbidden(key, item.forbidden);
}

function matchesRequiredTokens(item, key) {
  if (item.exactOnly) return false;
  if (!item.required?.length) return false;
  return hasRequired(key, item.required) && !hasForbidden(key, item.forbidden);
}

function mappedResult(item) {
  return { status: "mapped", displayName: item.displayName, item };
}

function ambiguousResult(hits, productName) {
  return {
    status: "ambiguous",
    displayName: null,
    item: null,
    candidates: hits.map((h) => h.displayName),
    sourceName: productName,
  };
}

/**
 * Map a Foodics / menu product name onto at most one tracked upsell item.
 * Approved aliases and exact keys win. Required-token fallback never
 * overrides an exact identity and cannot merge a shorter source name
 * into a longer tracked label (e.g. Big Nac ≠ Big NAC New).
 */
export function matchTrackedUpsell(productName) {
  const key = normKey(productName);
  if (!key) return { status: "unmapped", displayName: null, item: null };

  const exactHits = TRACKED_UPSELL_ITEMS.filter((item) => matchesExact(item, key));
  if (exactHits.length === 1) return mappedResult(exactHits[0]);
  if (exactHits.length > 1) return ambiguousResult(exactHits, productName);

  const tokenHits = TRACKED_UPSELL_ITEMS.filter((item) => matchesRequiredTokens(item, key));
  if (tokenHits.length === 1) return mappedResult(tokenHits[0]);
  if (tokenHits.length > 1) return ambiguousResult(tokenHits, productName);

  return { status: "unmapped", displayName: null, item: null, sourceName: productName };
}

export function trackedUpsellDisplayNames() {
  return TRACKED_UPSELL_ITEMS.map((item) => item.displayName);
}
