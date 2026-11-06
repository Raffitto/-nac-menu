import { parseAllergenCodes } from "./officialMenuAllergens";

const CODE_GROUP = "\\((?:[a-z]{1,3}(?:\\s*,\\s*[a-z]{1,3})*)\\)";
const INLINE = new RegExp(
  `^(.+?)\\s*(${CODE_GROUP})?\\s*(\\d+(?:\\.\\d+)?)\\s*cal\\s*(\\d+)\\s*-\\.?$`,
  "i",
);
const PRICE_FIRST = new RegExp(
  `^(\\d+)\\s*-\\.?\\s*(.+?)\\s*(${CODE_GROUP})?\\s*(\\d+(?:\\.\\d+)?)\\s*cal\\.?$`,
  "i",
);

function cleanFragment(value) {
  return String(value || "")
    .replace(/\((?:please\s+)?allow[^)]*\)/ig, " ")
    .replace(/\(\(/g, "(")
    .replace(/(cal\s+\d+\s*-\.)\s*[A-Za-z].*$/i, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value) {
  return String(value || "")
    .replace(/^[\s.,:;|-]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.,]$/, "")
    .trim();
}

function skipFragment(line) {
  return !line
    || /good food|include 15|prepared in a kitchen|intoleran|grand house|al hizam|al thahabi|nacriyadh|@nac|966/i.test(line)
    || /[\u0600-\u06FF]/.test(line);
}

function itemFrom(source, name, codes, calories, price, association) {
  const cleaned = cleanName(name);
  if (cleaned.length < 3) return null;
  const allergens = parseAllergenCodes(codes || "");
  if (allergens.unknown.length) return null;
  return {
    source,
    name: cleaned,
    calories: Number(calories),
    priceSar: Number(price),
    allergenCodes: allergens.codes,
    allergenNames: allergens.names,
    association,
  };
}

/** High-confidence rows keep the printed calorie and price on the same fragment. */
export function parseOfficialMenuText(text, source) {
  const items = [];
  const fragments = String(text || "").split(/\n/).flatMap((line) => line.split("|"));
  for (let index = 0; index < fragments.length; index += 1) {
    let line = cleanFragment(fragments[index]);
    if (skipFragment(line)) continue;
    if (!/cal/i.test(line) && fragments[index + 1] && /cal/i.test(fragments[index + 1])) {
      line = cleanFragment(`${line} ${fragments[index + 1]}`);
      index += 1;
    }
    const inline = line.match(INLINE);
    if (inline) {
      const item = itemFrom(source, inline[1], inline[2], inline[3], inline[4], "name-calorie-price");
      if (item) items.push(item);
      continue;
    }
    const lead = line.match(PRICE_FIRST);
    if (lead) {
      const item = itemFrom(source, lead[2], lead[3], lead[4], lead[1], "price-before-name");
      if (item) items.push(item);
    }
  }
  return items;
}

export function normalizeMenuName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A unique Foodics name is a candidate only. It is not a verified mapping
 * and it does not merge a product with an ingredient.
 */
export function candidateFoodicsMatches(item, products = []) {
  const wanted = normalizeMenuName(item.name);
  const hits = (products || []).filter((product) => normalizeMenuName(product.name) === wanted);
  if (hits.length === 1 && wanted.split(" ").length < 2) {
    return { status: "short_name_needs_review", foodicsId: hits[0].id, sku: hits[0].sku || null };
  }
  if (hits.length === 1) {
    return { status: "unique_name_candidate", foodicsId: hits[0].id, sku: hits[0].sku || null };
  }
  if (hits.length > 1) return { status: "ambiguous_name", count: hits.length };
  return { status: "unmatched" };
}
