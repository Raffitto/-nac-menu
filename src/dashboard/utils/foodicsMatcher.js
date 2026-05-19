import { dedupeImportRows } from "./foodicsImportDedupe";
import { normalizeFoodicsName } from "./foodicsNameNormalize";
import { classifyFoodicsRow } from "./foodicsClassifier";
import {
  buildAliasLookup,
  resolveAliasFromLookup,
  resolveAmbiguousAlias,
} from "./foodicsAliasDictionary";

const STOP_WORDS = new Set(["the", "a", "an", "with", "and", "or", "of", "sar", "pcs", "pc"]);

/** Auto-import without review */
const AUTO_MATCH_MIN = 0.85;
/** Persistent memory auto-applies from this confidence upward */
const MEMORY_AUTO_MIN = 0.72;
/** Show as suggested match in Needs Review */
const SUGGEST_MIN = 0.55;

function normalizeMatchType(type) {
  const map = {
    manual_map: "manual",
    token_similarity: "token",
    includes: "fuzzy",
    alias_ambiguous: "alias",
    alias_needs_review: "alias",
    unmatched: "unmatched",
    ignored: "ignored",
    memory: "memory",
    exact: "exact",
    alias: "alias",
    fuzzy: "fuzzy",
    token: "token",
  };
  return map[type] || type;
}

export function normalizeName(name) {
  return normalizeFoodicsName(name);
}

function tokenize(name) {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function tokenSet(name) {
  return new Set(tokenize(name));
}

function tokenSimilarity(a, b) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter += 1;
  });
  return inter / Math.max(ta.size, tb.size);
}

/** Extra tokens on menu side vs Foodics (e.g. Smoked + Paprika Prawn) */
function extraMenuTokens(foodicsName, menuName) {
  const tf = tokenSet(foodicsName);
  const tm = tokenSet(menuName);
  const extra = [];
  tm.forEach((t) => {
    if (!tf.has(t)) extra.push(t);
  });
  return extra;
}

function buildCatalogIndex(menuItems, addOns) {
  const byNorm = new Map();
  const catalog = [
    ...menuItems.map((mi) => ({ ...mi, kind: "item" })),
    ...addOns.map((a) => ({ id: a.id, name_en: a.name_en, kind: "addon" })),
  ];
  for (const item of catalog) {
    const key = normalizeFoodicsName(item.name_en);
    if (key && !byNorm.has(key)) byNorm.set(key, item);
  }
  return { byNorm, catalog };
}

function lookupPersistentMap(normalized, manualMaps) {
  for (const m of manualMaps) {
    const keys = [
      normalizeFoodicsName(m.normalized_key),
      normalizeFoodicsName(m.normalized_name),
      normalizeFoodicsName(m.raw_name),
      normalizeFoodicsName(m.foodics_name),
    ].filter(Boolean);
    if (keys.includes(normalized)) return m;
  }
  return null;
}

export function isIgnoredProductName(name) {
  return classifyFoodicsRow(name).autoIgnore;
}

function findMenuItemByName(menuItems, nameEn) {
  return menuItems.find((mi) => normalizeName(mi.name_en) === normalizeName(nameEn)) || null;
}

function findAddOnByName(addOns, nameEn) {
  return addOns.find((a) => normalizeName(a.name_en) === normalizeName(nameEn)) || null;
}

function resolveAliasTarget(rawName, menuItems, addOns, aliasLookup) {
  const n = normalizeName(rawName);
  const hit = resolveAliasFromLookup(n, aliasLookup);
  if (hit) {
    const item = findMenuItemByName(menuItems, hit.menu_item_name_en);
    const addon = findAddOnByName(addOns, hit.menu_item_name_en);
    if (item || addon) {
      return {
        target: hit.menu_item_name_en,
        ambiguous: false,
        confidence: hit.confidence,
        source: hit.source,
      };
    }
  }

  const amb = resolveAmbiguousAlias(n);
  if (amb) {
    return { target: amb.target, ambiguous: true, candidates: amb.candidates };
  }

  return null;
}

function enrichSemanticFields(row, classification) {
  return {
    foodics_class: classification.class,
    foodics_class_label: classification.label,
    semantic_class: classification.semantic_class || classification.class,
    analytics_category: classification.analytics_category,
    inherited_category: classification.inherited_category,
    track_as_modifier: classification.track_as_modifier,
  };
}

function scoreCandidate(foodicsName, item, { strictMatch }) {
  const menuNorm = normalizeName(item.name_en);
  const foodicsNorm = normalizeName(foodicsName);
  if (!menuNorm || !foodicsNorm) return { score: 0, matchType: "unmatched" };

  if (menuNorm === foodicsNorm) {
    return { score: 1, matchType: "exact" };
  }

  const extra = extraMenuTokens(foodicsName, item.name_en);
  const sim = tokenSimilarity(foodicsName, item.name_en);

  if (strictMatch) {
    if (extra.length > 0) {
      return { score: sim >= 0.99 ? 0.84 : Math.min(sim, 0.78), matchType: "token" };
    }
    if (sim >= 0.99) return { score: 0.92, matchType: "token" };
    return { score: 0, matchType: "unmatched" };
  }

  if (extra.length === 0 && sim >= 0.95) {
    return { score: 0.94, matchType: "token" };
  }

  if (extra.length <= 1 && sim >= 0.72) {
    const penalty = extra.length * 0.08;
    return { score: Math.min(0.88, sim - penalty + 0.1), matchType: "token" };
  }

  if (!strictMatch && extra.length <= 2) {
    const lenRatio =
      Math.min(menuNorm.length, foodicsNorm.length) / Math.max(menuNorm.length, foodicsNorm.length);
    if (
      (menuNorm.includes(foodicsNorm) || foodicsNorm.includes(menuNorm)) &&
      lenRatio >= 0.88 &&
      foodicsNorm.split(" ").length >= 3
    ) {
      return { score: lenRatio >= 0.92 ? 0.9 : 0.8, matchType: "fuzzy" };
    }
  }

  if (sim >= SUGGEST_MIN) {
    return { score: sim, matchType: "token" };
  }

  return { score: 0, matchType: "unmatched" };
}

function findBestCandidate(foodicsName, catalog, { strictMatch }) {
  let best = null;
  let bestScore = 0;
  let matchType = "unmatched";

  for (const item of catalog) {
    const { score, matchType: mt } = scoreCandidate(foodicsName, item, { strictMatch });
    if (score > bestScore) {
      bestScore = score;
      best = item;
      matchType = mt;
    }
  }

  if (!best || bestScore < SUGGEST_MIN) {
    return { matched: null, confidence: 0, matchType: "unmatched" };
  }

  return {
    matched: { id: best.id, name_en: best.name_en, kind: best.kind },
    confidence: Math.round(bestScore * 100) / 100,
    matchType: normalizeMatchType(matchType),
  };
}

function matchAgainstCatalog(nameToMatch, menuItems, addOns, manualMaps, classification) {
  const normalized = normalizeName(nameToMatch);
  const strictMatch = classification?.strictMatch ?? false;

  if (!normalized) {
    return {
      matched: null,
      suggestion: null,
      confidence: 0,
      matchType: "empty",
      needsReview: false,
    };
  }

  const manual = lookupPersistentMap(normalized, manualMaps);
  if (manual) {
    const menuItem = findMenuItemByName(menuItems, manual.menu_item_name_en);
    const addon = findAddOnByName(addOns, manual.menu_item_name_en);
    const target = menuItem || addon;
    if (target) {
      const conf = Number(manual.match_confidence ?? manual.confidence) || 1;
      const hit = {
        id: manual.menu_item_id || target.id || null,
        name_en: manual.menu_item_name_en,
        kind: menuItem ? "item" : "addon",
      };
      return {
        matched: hit,
        suggestion: hit,
        confidence: conf,
        matchType: "memory",
        needsReview: conf < MEMORY_AUTO_MIN,
      };
    }
  }

  const { byNorm, catalog } = buildCatalogIndex(menuItems, addOns);
  const exactHit = byNorm.get(normalized);
  if (exactHit) {
    const hit = { id: exactHit.id, name_en: exactHit.name_en, kind: exactHit.kind };
    return {
      matched: hit,
      suggestion: hit,
      confidence: 1,
      matchType: "exact",
      needsReview: false,
    };
  }

  const best = findBestCandidate(nameToMatch, catalog, { strictMatch });
  if (!best.matched) {
    return {
      matched: null,
      suggestion: null,
      confidence: 0,
      matchType: "unmatched",
      needsReview: true,
    };
  }

  const needsReview = best.confidence < AUTO_MATCH_MIN;
  return {
    matched: needsReview ? null : best.matched,
    suggestion: best.matched,
    confidence: best.confidence,
    matchType: best.matchType,
    needsReview,
  };
}

export function fuzzyMatchFoodicsItem(
  rawName,
  menuItems = [],
  manualMaps = [],
  addOns = [],
  rowMeta = {},
  aliasLookup = null,
) {
  const classification = classifyFoodicsRow(rawName, rowMeta.category);
  const lookup = aliasLookup || buildAliasLookup(manualMaps);

  if (classification.autoIgnore) {
    return {
      matched: null,
      suggestion: null,
      confidence: 0,
      matchType: "ignored",
      needsReview: false,
      import_status: "ignored",
      classification,
    };
  }

  const alias = resolveAliasTarget(rawName, menuItems, addOns, lookup);
  if (alias && !alias.ambiguous) {
    const item = findMenuItemByName(menuItems, alias.target);
    const addon = findAddOnByName(addOns, alias.target);
    const target = item || addon;
    if (target) {
      const conf = alias.confidence ?? 0.96;
      const hit = { id: target.id, name_en: target.name_en, kind: item ? "item" : "addon" };
      return {
        matched: hit,
        suggestion: hit,
        confidence: conf,
        matchType: alias.source === "memory" ? "memory" : "alias",
        needsReview: conf < AUTO_MATCH_MIN,
        classification,
      };
    }
  }

  if (alias?.ambiguous) {
    const fallback = matchAgainstCatalog(rawName, menuItems, addOns, manualMaps, classification);
    return { ...fallback, classification };
  }

  return matchAgainstCatalog(rawName, menuItems, addOns, manualMaps, classification);
}

export function matchImportRows(rows, menuItems, manualMaps, addOns = []) {
  const deduped = dedupeImportRows(rows);
  const aliasLookup = buildAliasLookup(manualMaps);

  return deduped.map((row) => {
    const rawName = row.raw_item_name || row.name;
    const classification = classifyFoodicsRow(rawName, row.category);
    const semantic = enrichSemanticFields(row, classification);

    if (classification.autoIgnore) {
      return {
        ...row,
        ...semantic,
        normalized_item_name: normalizeName(rawName),
        matched_menu_item_id: null,
        matched_menu_item_name: null,
        suggested_menu_item_name: null,
        suggested_confidence: 0,
        match_confidence: 0,
        match_type: "ignored",
        needs_review: false,
        import_status: "ignored",
      };
    }

    const result = fuzzyMatchFoodicsItem(
      rawName,
      menuItems,
      manualMaps,
      addOns,
      { category: row.category },
      aliasLookup,
    );
    const cls = result.classification || classification;
    const semanticResult = enrichSemanticFields(row, cls);
    const suggestedName = result.suggestion?.name_en || null;
    const suggestedConf = result.suggestion ? result.confidence : 0;

    const base = {
      ...row,
      ...semanticResult,
      normalized_item_name: normalizeName(rawName),
      suggested_menu_item_name: suggestedName,
      suggested_confidence: suggestedConf,
    };

    if (result.import_status === "ignored" || result.matchType === "ignored") {
      return {
        ...base,
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
        ...base,
        matched_menu_item_id: result.matched.id || null,
        matched_menu_item_name: result.matched.name_en,
        match_confidence: result.confidence,
        match_type: normalizeMatchType(result.matchType),
        needs_review: false,
        import_status: "matched",
      };
    }

    if (result.needsReview && suggestedName) {
      return {
        ...base,
        matched_menu_item_id: null,
        matched_menu_item_name: null,
        match_confidence: suggestedConf,
        match_type: normalizeMatchType(result.matchType),
        needs_review: true,
        import_status: "needs_review",
      };
    }

    return {
      ...base,
      matched_menu_item_id: null,
      matched_menu_item_name: null,
      match_confidence: 0,
      match_type: "unmatched",
      needs_review: true,
      import_status: "needs_review",
    };
  });
}
