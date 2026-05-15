const STOP_WORDS = new Set(["the", "a", "an", "with", "and", "or", "of", "sar", "pcs", "pc"]);

export function normalizeName(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .toLowerCase()
    .replace(/sar/gi, "")
    .replace(/[^\w\s\u0600-\u06FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * @param {string} rawName
 * @param {Array<{ id?: string, name_en: string }>} menuItems
 * @param {Array<{ raw_name: string, normalized_name?: string, menu_item_name_en: string, menu_item_id?: string, confidence?: number }>} manualMaps
 */
export function fuzzyMatchFoodicsItem(rawName, menuItems = [], manualMaps = []) {
  const normalized = normalizeName(rawName);
  if (!normalized) {
    return { matched: null, confidence: 0, matchType: "empty", needsReview: true };
  }

  const manual = manualMaps.find(
    (m) => normalizeName(m.raw_name) === normalized || normalizeName(m.normalized_name) === normalized,
  );
  if (manual) {
    const menuItem = menuItems.find((mi) => mi.name_en === manual.menu_item_name_en);
    return {
      matched: {
        id: manual.menu_item_id || menuItem?.id || null,
        name_en: manual.menu_item_name_en,
      },
      confidence: Number(manual.confidence) || 1,
      matchType: "manual_map",
      needsReview: false,
    };
  }

  let best = null;
  let bestScore = 0;
  let matchType = "unmatched";

  for (const item of menuItems) {
    const menuNorm = normalizeName(item.name_en);
    if (!menuNorm) continue;

    if (menuNorm === normalized) {
      return {
        matched: { id: item.id, name_en: item.name_en },
        confidence: 1,
        matchType: "exact",
        needsReview: false,
      };
    }

    if (menuNorm.includes(normalized) || normalized.includes(menuNorm)) {
      const score = 0.88;
      if (score > bestScore) {
        bestScore = score;
        best = item;
        matchType = "includes";
      }
      continue;
    }

    const sim = tokenSimilarity(rawName, item.name_en);
    if (sim > bestScore) {
      bestScore = sim;
      best = item;
      matchType = "token_similarity";
    }
  }

  if (best && bestScore >= 0.55) {
    return {
      matched: { id: best.id, name_en: best.name_en },
      confidence: Math.round(bestScore * 100) / 100,
      matchType,
      needsReview: bestScore < 0.75,
    };
  }

  return { matched: null, confidence: 0, matchType: "unmatched", needsReview: true };
}

export function matchImportRows(rows, menuItems, manualMaps) {
  return rows.map((row) => {
    const result = fuzzyMatchFoodicsItem(row.raw_item_name || row.name, menuItems, manualMaps);
    return {
      ...row,
      normalized_item_name: normalizeName(row.raw_item_name || row.name),
      matched_menu_item_id: result.matched?.id || null,
      matched_menu_item_name: result.matched?.name_en || null,
      match_confidence: result.confidence,
      match_type: result.matchType,
      needs_review: result.needsReview,
    };
  });
}
