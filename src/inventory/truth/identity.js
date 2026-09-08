import { isVerificationFixture } from "../foodBible";
import { normalizeText } from "../inventoryIntelligence";
import { COST_CLASS, IDENTITY_CONFIDENCE, SOURCE_SYSTEM } from "./contracts";

export function displayIngredientName(row) {
  return String(row?.canonicalName || row?.canonical_name || row?.name || "").trim();
}

export function resolveCanonicalIngredient(row, extras = {}) {
  const id = row?.id || row?.canonicalIngredientId || null;
  const displayName = displayIngredientName(row);
  const sku = extras.sku && String(extras.sku).trim() ? String(extras.sku).trim() : null;
  const placeholder = isVerificationFixture(displayName) || /INV-OCR|\[temp verify/i.test(displayName);
  const inactive = row?.active === false;
  const issues = [...(extras.identityIssues || [])];
  if (!id) issues.push("missing_canonical_id");
  if (placeholder) issues.push("ocr_placeholder");
  if (inactive) issues.push("inactive_identity");
  if (extras.duplicateNormalizedName) issues.push("same_normalized_name_different_id");
  if (extras.skuCollision) issues.push("duplicate_sku");
  if (extras.skuNameMismatch) issues.push("same_sku_different_name");
  if (extras.missingSku) issues.push("missing_sku");

  let identityConfidence = IDENTITY_CONFIDENCE.CANONICAL_ID;
  if (placeholder) identityConfidence = IDENTITY_CONFIDENCE.OCR_PLACEHOLDER;
  else if (inactive) identityConfidence = IDENTITY_CONFIDENCE.LEGACY;
  else if (extras.skuCollision || extras.duplicateNormalizedName || extras.skuNameMismatch) {
    identityConfidence = IDENTITY_CONFIDENCE.AMBIGUOUS;
  } else if (sku && extras.skuVerified) identityConfidence = IDENTITY_CONFIDENCE.VERIFIED_SKU;

  return {
    canonicalIngredientId: id,
    displayName,
    sourceIngredientId: id,
    sourceSystem: SOURCE_SYSTEM.NAC_INVENTORY,
    sku,
    baseUom: row?.baseInventoryUnit || row?.base_inventory_unit || null,
    activeStatus: inactive ? "inactive" : "active",
    legacyStatus: inactive ? "legacy" : "current",
    costStatus: extras.costStatus || COST_CLASS.UNKNOWN,
    identityConfidence,
    identityIssues: issues,
  };
}

function catalogueSkuMap(catalogueItems = []) {
  const byIngredient = new Map();
  const bySku = new Map();
  for (const item of catalogueItems || []) {
    const sku = String(item.supplierSku || item.supplier_sku || "").trim();
    const ingredientId = item.ingredientId || item.ingredient_id;
    const name = item.originalProductName || item.original_product_name || "";
    const verified = (item.verificationState || item.verification_state) === "verified";
    if (ingredientId) {
      const current = byIngredient.get(ingredientId) || [];
      current.push({ sku: sku || null, verified, name });
      byIngredient.set(ingredientId, current);
    }
    if (!sku) continue;
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push({ ingredientId, name, verified });
  }
  return { byIngredient, bySku };
}

export function classifyIngredientIdentities({ ingredients = [], catalogueItems = [] } = {}) {
  const { byIngredient, bySku } = catalogueSkuMap(catalogueItems);
  const byNormalized = new Map();
  for (const row of ingredients || []) {
    const key = normalizeText(displayIngredientName(row));
    if (!key) continue;
    if (!byNormalized.has(key)) byNormalized.set(key, []);
    byNormalized.get(key).push(row);
  }

  const skuIssues = [];
  for (const [sku, rows] of bySku.entries()) {
    const ingredientIds = [...new Set(rows.map((r) => r.ingredientId).filter(Boolean))];
    const names = [...new Set(rows.map((r) => normalizeText(r.name)).filter(Boolean))];
    if (ingredientIds.length > 1) {
      skuIssues.push({
        code: "duplicate_sku",
        sku,
        ingredientIds,
        message: `SKU ${sku} is linked to ${ingredientIds.length} ingredients`,
      });
    } else if (names.length > 1) {
      skuIssues.push({
        code: "same_sku_different_name",
        sku,
        ingredientIds,
        message: `SKU ${sku} appears with different catalogue names`,
      });
    }
  }

  const identities = (ingredients || []).map((row) => {
    const key = normalizeText(displayIngredientName(row));
    const namePeers = byNormalized.get(key) || [];
    const links = byIngredient.get(row.id) || [];
    const verifiedSkus = [...new Set(links.filter((l) => l.sku && l.verified).map((l) => l.sku))];
    const sku = verifiedSkus.length === 1 ? verifiedSkus[0] : null;
    const collision = skuIssues.some((issue) => issue.ingredientIds.includes(row.id) && issue.code === "duplicate_sku");
    const nameMismatch = skuIssues.some((issue) => issue.ingredientIds.includes(row.id) && issue.code === "same_sku_different_name");
    return resolveCanonicalIngredient(row, {
      sku,
      skuVerified: Boolean(sku),
      missingSku: !sku,
      skuCollision: collision,
      skuNameMismatch: nameMismatch,
      duplicateNormalizedName: namePeers.length > 1,
    });
  });

  return {
    identities,
    skuIssues,
    duplicateNormalizedNames: [...byNormalized.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([normalizedName, rows]) => ({
        normalizedName,
        ingredientIds: rows.map((row) => row.id),
      })),
    missingSkuCount: identities.filter((row) => row.identityIssues.includes("missing_sku")).length,
    ambiguousCount: identities.filter((row) => row.identityConfidence === IDENTITY_CONFIDENCE.AMBIGUOUS).length,
  };
}
