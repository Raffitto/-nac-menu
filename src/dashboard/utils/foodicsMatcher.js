const STOP_WORDS = new Set(["the", "a", "an", "with", "and", "or", "of", "sar", "pcs", "pc"]);

/** Never auto-import below this confidence */
const AUTO_MATCH_MIN = 0.85;
/** Suggest match for manual review */
const REVIEW_MIN = 0.72;

function normalizeMatchType(type) {
  const map = {
    manual_map: "manual",
    token_similarity: "token",
    includes: "fuzzy",
    alias_ambiguous: "alias",
    alias_needs_review: "alias",
    unmatched: "unmatched",
    ignored: "ignored",
  };
  return map[type] || type;
}

/** Report / summary rows — never import */
const IGNORED_PRODUCTS = new Set(
  [
    "title",
    "date range",
    "product",
    "all together",
    "whatever is done",
    "love your main course",
    "love your desserts",
    "love your drinks",
    "regular ketchup",
    "regular mayo",
    "sriracha sauce",
    "chilli flakes",
    "chili flakes",
    "extra shot",
    "fresh milk",
    "chocolate sauce",
    "truffle mayo",
    "parmesan",
    "pita bread",
  ].map((s) => s.toLowerCase()),
);

/** Foodics name → menu item name_en */
const FOODICS_ALIASES = {
  rigatoni: "Rigatoni Pink Sauce",
  burrata: "Crushed Burrata",
  "french toast": "Speculoos French Toast",
  cookies: "Crushed Milk Chocolate Cookies",
  "granola yoghurt": "Greek Yogurt",
  "granola yogurt": "Greek Yogurt",
  "egg bun": "Scrambled Eggs",
  "passionfruit lemonade": "Passion Fruit Lemonade",
  "passion fruit lemonade": "Passion Fruit Lemonade",
  "passionfruit mojito": "Passion Fruit Mojito",
  "passion fruit mojito": "Passion Fruit Mojito",
  "sparkling water-sm": "Small Sparkling Water",
  "sparkling water sm": "Small Sparkling Water",
  "orange juice": "Orange",
  "carrot, apple, ginger": "Carrot, Apple & Ginger",
  "carrot apple ginger": "Carrot, Apple & Ginger",
  "beetroot, apple, celery": "Apple, Beetroot & Celery",
  "beetroot apple celery": "Apple, Beetroot & Celery",
  "black angus steak au poivre": "Black Angus Steak Au Poivre",
  "pavlova pistachio & raspberry": "Strawberry Pistachio Pavlova",
  "pavlova pistachio and raspberry": "Strawberry Pistachio Pavlova",
  "panier de viennoiserie": "Daily Pastries Basket",
  "sparkling water": "Large Sparkling Water",
};

/** Short codes — only map when fuzzy confidence is high */
const AMBIGUOUS_ALIASES = {
  "quinoa s": ["Quinoa"],
  "kale s": ["Kale & Cabbage"],
  "kale b": ["Kale & Cabbage"],
};

export function normalizeName(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .toLowerCase()
    .replace(/sar/gi, "")
    .replace(/[^\w\s\u0600-\u06FF&,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isIgnoredProductName(name) {
  const raw = normCell(name);
  const n = normalizeName(raw);
  if (!n) return true;
  if (/^\*+$/.test(raw.replace(/\s/g, ""))) return true;
  if (IGNORED_PRODUCTS.has(n)) return true;
  if (n === "value" || n.startsWith("sales by product")) return true;
  return false;
}

function normCell(v) {
  return String(v ?? "").trim();
}

function tokenize(name) {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function tokenSimilarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter += 1;
  });
  return inter / Math.max(ta.size, tb.size);
}

function findMenuItemByName(menuItems, nameEn) {
  return menuItems.find((mi) => normalizeName(mi.name_en) === normalizeName(nameEn)) || null;
}

function findAddOnByName(addOns, nameEn) {
  return addOns.find((a) => normalizeName(a.name_en) === normalizeName(nameEn)) || null;
}

function resolveAliasTarget(rawName, menuItems) {
  const n = normalizeName(rawName);

  for (const [key, target] of Object.entries(FOODICS_ALIASES)) {
    if (n === normalizeName(key) && findMenuItemByName(menuItems, target)) {
      return { target, ambiguous: false };
    }
  }

  for (const [key, candidates] of Object.entries(AMBIGUOUS_ALIASES)) {
    if (n === normalizeName(key)) {
      return { target: candidates[0], ambiguous: true, candidates };
    }
  }

  return null;
}

function matchAgainstCatalog(nameToMatch, menuItems, addOns, manualMaps) {
  const normalized = normalizeName(nameToMatch);
  if (!normalized) {
    return { matched: null, confidence: 0, matchType: "empty", needsReview: false };
  }

  const manual = manualMaps.find(
    (m) => normalizeName(m.raw_name) === normalized || normalizeName(m.normalized_name) === normalized,
  );
  if (manual) {
    const menuItem = findMenuItemByName(menuItems, manual.menu_item_name_en);
    const addon = findAddOnByName(addOns, manual.menu_item_name_en);
    const target = menuItem || addon;
    if (target) {
      const conf = Number(manual.confidence) || 1;
      return {
        matched: {
          id: manual.menu_item_id || target.id || null,
          name_en: manual.menu_item_name_en,
          kind: menuItem ? "item" : "addon",
        },
        confidence: conf,
        matchType: "manual",
        needsReview: conf < AUTO_MATCH_MIN,
      };
    }
  }

  const catalog = [
    ...menuItems.map((mi) => ({ ...mi, kind: "item" })),
    ...addOns.map((a) => ({ id: a.id, name_en: a.name_en, kind: "addon" })),
  ];

  let best = null;
  let bestScore = 0;
  let matchType = "unmatched";

  for (const item of catalog) {
    const menuNorm = normalizeName(item.name_en);
    if (!menuNorm) continue;

    if (menuNorm === normalized) {
      return {
        matched: { id: item.id, name_en: item.name_en, kind: item.kind },
        confidence: 1,
        matchType: "exact",
        needsReview: false,
      };
    }

    if (menuNorm.includes(normalized) || normalized.includes(menuNorm)) {
      const lenRatio = Math.min(menuNorm.length, normalized.length) / Math.max(menuNorm.length, normalized.length);
      const score = lenRatio >= 0.85 ? 0.9 : 0.78;
      if (score > bestScore) {
        bestScore = score;
        best = item;
        matchType = "fuzzy";
      }
      continue;
    }

    const sim = tokenSimilarity(nameToMatch, item.name_en);
    if (sim > bestScore) {
      bestScore = sim;
      best = item;
      matchType = "token";
    }
  }

  if (best && bestScore >= REVIEW_MIN) {
    const confidence = Math.round(bestScore * 100) / 100;
    return {
      matched: { id: best.id, name_en: best.name_en, kind: best.kind },
      confidence,
      matchType: normalizeMatchType(matchType),
      needsReview: confidence < AUTO_MATCH_MIN,
    };
  }

  return { matched: null, confidence: 0, matchType: "unmatched", needsReview: true };
}

/**
 * @param {string} rawName
 * @param {Array<{ id?: string, name_en: string }>} menuItems
 * @param {Array<{ raw_name: string, menu_item_name_en: string, menu_item_id?: string, confidence?: number }>} manualMaps
 * @param {Array<{ id?: string, name_en: string }>} [addOns]
 */
export function fuzzyMatchFoodicsItem(rawName, menuItems = [], manualMaps = [], addOns = []) {
  if (isIgnoredProductName(rawName)) {
    return {
      matched: null,
      confidence: 0,
      matchType: "ignored",
      needsReview: false,
      import_status: "ignored",
    };
  }

  const alias = resolveAliasTarget(rawName, menuItems);
  if (alias && !alias.ambiguous) {
    const item = findMenuItemByName(menuItems, alias.target);
    if (item) {
      return {
        matched: { id: item.id, name_en: item.name_en, kind: "item" },
        confidence: 0.95,
        matchType: "alias",
        needsReview: false,
      };
    }
  }

  if (alias?.ambiguous) {
    for (const candidate of alias.candidates) {
      const result = matchAgainstCatalog(candidate, menuItems, addOns, manualMaps);
      if (result.matched && result.confidence >= 0.75) {
        return { ...result, matchType: "alias_ambiguous", needsReview: false };
      }
    }
    const fallback = matchAgainstCatalog(rawName, menuItems, addOns, manualMaps);
    if (fallback.matched) {
      return { ...fallback, needsReview: true, matchType: "alias_needs_review" };
    }
    return { matched: null, confidence: 0, matchType: "unmatched", needsReview: true };
  }

  return matchAgainstCatalog(rawName, menuItems, addOns, manualMaps);
}

export function matchImportRows(rows, menuItems, manualMaps, addOns = []) {
  return rows.map((row) => {
    const rawName = row.raw_item_name || row.name;

    if (isIgnoredProductName(rawName)) {
      return {
        ...row,
        normalized_item_name: normalizeName(rawName),
        matched_menu_item_id: null,
        matched_menu_item_name: null,
        match_confidence: 0,
        match_type: "ignored",
        needs_review: false,
        import_status: "ignored",
      };
    }

    const result = fuzzyMatchFoodicsItem(rawName, menuItems, manualMaps, addOns);

    if (result.import_status === "ignored" || result.matchType === "ignored") {
      return {
        ...row,
        normalized_item_name: normalizeName(rawName),
        matched_menu_item_id: null,
        matched_menu_item_name: null,
        match_confidence: 0,
        match_type: "ignored",
        needs_review: false,
        import_status: "ignored",
      };
    }

    if (result.matched && !result.needsReview) {
      return {
        ...row,
        normalized_item_name: normalizeName(rawName),
        matched_menu_item_id: result.matched.id || null,
        matched_menu_item_name: result.matched.name_en,
        match_confidence: result.confidence,
        match_type: normalizeMatchType(result.matchType),
        needs_review: false,
        import_status: "matched",
      };
    }

    if (result.matched && result.needsReview) {
      return {
        ...row,
        normalized_item_name: normalizeName(rawName),
        matched_menu_item_id: result.matched.id || null,
        matched_menu_item_name: result.matched.name_en,
        match_confidence: result.confidence,
        match_type: normalizeMatchType(result.matchType),
        needs_review: true,
        import_status: "needs_review",
      };
    }

    return {
      ...row,
      normalized_item_name: normalizeName(rawName),
      matched_menu_item_id: null,
      matched_menu_item_name: null,
      match_confidence: 0,
      match_type: "unmatched",
      needs_review: true,
      import_status: "needs_review",
    };
  });
}
