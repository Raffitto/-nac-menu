/**
 * Multi-strategy catalog search — exact, normalized, alias, partial (modifiers/add-ons).
 */

import { normalizeFoodicsName } from "../../dashboard/utils/foodicsNameNormalize";
import { resolveAliasFromLookup } from "../../dashboard/utils/foodicsAliasDictionary";

const STOP = new Set(["the", "a", "an", "with", "and", "or", "of"]);

function tokens(s) {
  return normalizeFoodicsName(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * @returns {{ match: object|null, strategy: string|null, confidence: number }}
 */
export function searchCatalogMultiMatch(term, { menuItems = [], addOns = [], aliasLookup = {} } = {}) {
  const raw = String(term || "").trim();
  if (!raw) return { match: null, strategy: null, confidence: 0 };

  const norm = normalizeFoodicsName(raw);
  const catalog = [
    ...(menuItems || []).map((mi) => ({ ...mi, kind: "item" })),
    ...(addOns || []).map((a) => ({ id: a.id, name_en: a.name_en, kind: "addon" })),
  ];

  // 1. Exact
  for (const c of catalog) {
    if (normalizeFoodicsName(c.name_en) === norm) {
      return { match: c, strategy: "exact", confidence: 1 };
    }
  }

  // 2. Alias
  const aliasHit = resolveAliasFromLookup(norm, aliasLookup);
  if (aliasHit?.menu_item_name_en) {
    const found =
      catalog.find((c) => normalizeFoodicsName(c.name_en) === normalizeFoodicsName(aliasHit.menu_item_name_en)) ||
      null;
    if (found) return { match: found, strategy: "alias", confidence: aliasHit.confidence || 0.85 };
  }

  // 3. Normalized includes
  for (const c of catalog) {
    const cn = normalizeFoodicsName(c.name_en);
    if (cn.includes(norm) || norm.includes(cn)) {
      return { match: c, strategy: "normalized", confidence: 0.78 };
    }
  }

  // 4. Partial token overlap (modifiers/sauces)
  const tt = tokens(raw);
  let best = null;
  let bestScore = 0;
  for (const c of catalog) {
    const ct = new Set(tokens(c.name_en));
    if (!ct.size) continue;
    let inter = 0;
    tt.forEach((t) => {
      if (ct.has(t)) inter += 1;
    });
    const score = inter / Math.max(tt.length, ct.size);
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      best = c;
    }
  }
  if (best) return { match: best, strategy: "partial", confidence: Math.round(bestScore * 100) / 100 };

  return { match: null, strategy: null, confidence: 0 };
}

/** Prefer add-on/modifier matches for sauce/milk/shot terms. */
export function searchModifierCatalog(term, options = {}) {
  const result = searchCatalogMultiMatch(term, options);
  if (result.match?.kind === "addon") return result;
  const addOnOnly = searchCatalogMultiMatch(term, {
    ...options,
    menuItems: [],
  });
  return addOnOnly.match ? addOnOnly : result;
}
