/**
 * Canonical recipe-validity contract.
 * Structural activation and Inventory Truth must share these rules.
 * Cost eligibility and legacy inventory_classification are signals, not gates.
 */

import { resolveCanonicalIngredient } from "./identity";
import { CONVERSION_STATUS, GRAPH_STATUS } from "./contracts";
import { analyticalRecipeLines, classifyRecipeLineKind, RECIPE_LINE_KIND, isDocumentationLineName } from "./recipeLineKind";
import { resolveRecipeLineUom } from "./uom";
import { SOURCE_EVIDENCE_CLASS } from "./readinessContracts";

export const RECIPE_VALIDITY = Object.freeze({
  VALID: "VALID",
  BLOCKED_DATA_QUALITY: "BLOCKED_DATA_QUALITY",
  BLOCKED_UOM: "BLOCKED_UOM",
  BLOCKED_SUBRECIPE: "BLOCKED_SUBRECIPE",
  BLOCKED_IDENTITY: "BLOCKED_IDENTITY",
  BLOCKED_OTHER: "BLOCKED_OTHER",
});

export const RECIPE_VALIDITY_CODE = Object.freeze({
  UNRESOLVED_RECIPE_LINE: "UNRESOLVED_RECIPE_LINE",
  INVALID_SUBRECIPE_VERSION_OR_UNIT: "INVALID_SUBRECIPE_VERSION_OR_UNIT",
  RECIPE_CYCLE: "RECIPE_CYCLE",
  EMPTY_RECIPE: "EMPTY_RECIPE",
  INVALID_OUTPUT: "INVALID_OUTPUT",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  MISSING_UOM: "MISSING_UOM",
  INCOMPATIBLE_UOM: "INCOMPATIBLE_UOM",
  MISSING_IDENTITY: "MISSING_IDENTITY",
  OCR_PLACEHOLDER: "OCR_PLACEHOLDER",
  DOCUMENTATION_LINE: "DOCUMENTATION_LINE",
  SOURCE_ACKNOWLEDGEMENT_REQUIRED: "SOURCE_ACKNOWLEDGEMENT_REQUIRED",
  ACTIVATION_REASON_REQUIRED: "ACTIVATION_REASON_REQUIRED",
});

export const OPERATIONAL_CHANGE_REASONS = Object.freeze([
  { value: "chef_operational_update", label: "Chef operational update" },
  { value: "seasonal_adjustment", label: "Seasonal adjustment" },
  { value: "supplier_substitution", label: "Supplier substitution" },
  { value: "portion_adjustment", label: "Portion adjustment" },
  { value: "correction", label: "Correction" },
  { value: "other", label: "Other" },
]);

export const PRODUCTION_SQL_GATES = Object.freeze({
  usesInventoryClassification: false,
  requiresRecipeCostEligible: true,
  requiresExactSubrecipeOutputUnit: true,
  treatsDocumentationAsUnresolvedLine: true,
  costEligibleDefault: false,
  classificationDefault: "other",
});

function statusOf(version) {
  return String(version?.status || "").toLowerCase();
}

function lineId(line) {
  return line?.id || line?.clientId || null;
}

export function recipeYield(recipe, version) {
  const quantity = version?.output_quantity ?? version?.outputQuantity ?? recipe?.output_quantity ?? recipe?.outputQuantity;
  const unit = version?.output_unit ?? version?.outputUnit ?? recipe?.output_unit ?? recipe?.outputUnit;
  return { quantity, unit };
}

export function versionCoversTimestamp(version, asOf) {
  if (asOf == null || asOf === "") return statusOf(version) === "active";
  const status = statusOf(version);
  if (status !== "active" && status !== "retired") return false;
  const from = version.effective_from || version.effectiveFrom;
  const to = version.effective_to || version.effectiveTo;
  const time = Date.parse(asOf);
  if (!Number.isFinite(time)) return false;
  if (from && Date.parse(from) > time) return false;
  if (to && Date.parse(to) <= time) return false;
  return true;
}

export function isOcrPlaceholderIngredient(ingredient) {
  const identity = resolveCanonicalIngredient(ingredient || {});
  return identity.identityIssues.includes("ocr_placeholder");
}

export function classifyIngredientReadiness(ingredient, line = {}) {
  const identity = resolveCanonicalIngredient(ingredient || {});
  if (!identity.canonicalIngredientId) {
    return {
      ok: false,
      code: RECIPE_VALIDITY_CODE.MISSING_IDENTITY,
      bucket: RECIPE_VALIDITY.BLOCKED_IDENTITY,
      reason: "Recipe line has no canonical ingredient id",
    };
  }
  if (identity.identityIssues.includes("ocr_placeholder")) {
    return {
      ok: false,
      code: RECIPE_VALIDITY_CODE.OCR_PLACEHOLDER,
      bucket: RECIPE_VALIDITY.BLOCKED_IDENTITY,
      reason: `${identity.displayName || "ingredient"} is an OCR / verification placeholder`,
    };
  }
  if (identity.activeStatus === "inactive") {
    return {
      ok: false,
      code: RECIPE_VALIDITY_CODE.UNRESOLVED_RECIPE_LINE,
      bucket: RECIPE_VALIDITY.BLOCKED_IDENTITY,
      reason: `${identity.displayName || "ingredient"} is inactive`,
    };
  }
  if (!identity.baseUom) {
    return {
      ok: false,
      code: RECIPE_VALIDITY_CODE.MISSING_UOM,
      bucket: RECIPE_VALIDITY.BLOCKED_UOM,
      reason: `${identity.displayName || "ingredient"} has no base inventory unit`,
    };
  }
  const name = identity.displayName || line.name;
  if (isDocumentationLineName(name)) {
    return {
      ok: true,
      code: RECIPE_VALIDITY_CODE.DOCUMENTATION_LINE,
      bucket: RECIPE_VALIDITY.VALID,
      documentation: true,
    };
  }
  return { ok: true, code: null, bucket: RECIPE_VALIDITY.VALID, identity };
}

export function evaluateProductionSqlLine(line, ingredient) {
  if (!line.ingredient_id && !line.sub_recipe_id && !line.ingredientId && !line.subRecipeId) {
    return RECIPE_VALIDITY_CODE.UNRESOLVED_RECIPE_LINE;
  }
  if ((line.ingredient_id || line.ingredientId) && (line.sub_recipe_id || line.subRecipeId)) {
    return RECIPE_VALIDITY_CODE.UNRESOLVED_RECIPE_LINE;
  }
  const qty = Number(line.canonical_quantity ?? line.canonicalQuantity ?? line.quantity);
  if (!(qty > 0)) return RECIPE_VALIDITY_CODE.UNRESOLVED_RECIPE_LINE;
  const ingredientId = line.ingredient_id || line.ingredientId;
  if (!ingredientId) return null;
  if (!ingredient || ingredient.active === false) return RECIPE_VALIDITY_CODE.UNRESOLVED_RECIPE_LINE;
  if (ingredient.recipe_cost_eligible !== true && ingredient.recipeCostEligible !== true) {
    return RECIPE_VALIDITY_CODE.UNRESOLVED_RECIPE_LINE;
  }
  const base = ingredient.base_inventory_unit || ingredient.baseInventoryUnit;
  const canonical = line.canonical_unit || line.canonicalUnit;
  if (base && canonical && base !== canonical) return RECIPE_VALIDITY_CODE.UNRESOLVED_RECIPE_LINE;
  return null;
}

function bucketForCode(code) {
  if (code === RECIPE_VALIDITY_CODE.INCOMPATIBLE_UOM || code === CONVERSION_STATUS.INCOMPATIBLE || code === CONVERSION_STATUS.MISSING_CONVERSION) {
    return RECIPE_VALIDITY.BLOCKED_UOM;
  }
  if (code === RECIPE_VALIDITY_CODE.INVALID_SUBRECIPE_VERSION_OR_UNIT || code === GRAPH_STATUS.INACTIVE_VERSION || code === GRAPH_STATUS.MISSING_SUB_RECIPE) {
    return RECIPE_VALIDITY.BLOCKED_SUBRECIPE;
  }
  if (code === RECIPE_VALIDITY_CODE.RECIPE_CYCLE || code === GRAPH_STATUS.CIRCULAR) {
    return RECIPE_VALIDITY.BLOCKED_DATA_QUALITY;
  }
  if (code === RECIPE_VALIDITY_CODE.MISSING_IDENTITY || code === RECIPE_VALIDITY_CODE.OCR_PLACEHOLDER) {
    return RECIPE_VALIDITY.BLOCKED_IDENTITY;
  }
  if (code === RECIPE_VALIDITY_CODE.SOURCE_ACKNOWLEDGEMENT_REQUIRED || code === RECIPE_VALIDITY_CODE.ACTIVATION_REASON_REQUIRED) {
    return RECIPE_VALIDITY.BLOCKED_OTHER;
  }
  return RECIPE_VALIDITY.BLOCKED_DATA_QUALITY;
}

export function sourceDiffRequiresAcknowledgement(sourceClass) {
  return sourceClass === SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_WITH_DIFFERENCES
    || sourceClass === SOURCE_EVIDENCE_CLASS.DATABASE_DRAFT_NEWER_THAN_SOURCE
    || sourceClass === SOURCE_EVIDENCE_CLASS.SOURCE_NEWER_THAN_DATABASE;
}

export function hasOperationalAcknowledgement(documentation = {}, { sourceClass } = {}) {
  if (!sourceDiffRequiresAcknowledgement(sourceClass)) return true;
  const change = documentation.operationalChange || documentation.operational_change || {};
  const reason = String(change.reason || "").trim();
  const allowed = OPERATIONAL_CHANGE_REASONS.some((item) => item.value === reason);
  return Boolean(change.acknowledged) && allowed;
}

export function formatSourceDiff(differences = []) {
  return (differences || []).map((row) => {
    if (row.draftName && !row.sourceName) return { kind: "added", label: `+ ${row.draftName}` };
    if (row.sourceName && !row.draftName) return { kind: "removed", label: `− ${row.sourceName}` };
    const qtyChanged = String(row.sourceQty ?? "") !== String(row.draftQty ?? "");
    const unitChanged = String(row.sourceUnit || "") !== String(row.draftUnit || "");
    const name = row.draftName || row.sourceName;
    if (qtyChanged && unitChanged) {
      return { kind: "changed", label: `${name}: ${row.sourceQty} ${row.sourceUnit} → ${row.draftQty} ${row.draftUnit}` };
    }
    if (qtyChanged) {
      return { kind: "quantity", label: `${name}: ${row.sourceQty} → ${row.draftQty} ${row.draftUnit || row.sourceUnit || ""}`.trim() };
    }
    if (unitChanged) {
      return { kind: "uom", label: `${name}: ${row.sourceUnit} → ${row.draftUnit}` };
    }
    return { kind: "changed", label: `${name} changed` };
  });
}

export function evaluateCanonicalRecipeValidity({
  recipe,
  version,
  versions = [],
  lines = [],
  ingredients = [],
  allRecipes = [],
  sourceClass = null,
  documentation = {},
  activationReason = "",
  requireActivationPolicy = false,
} = {}) {
  const errors = [];
  const ingredientById = new Map((ingredients || []).map((row) => [row.id, row]));
  const recipeById = new Map((allRecipes || []).map((row) => [row.id, row]));
  const yieldInfo = recipeYield(recipe, version);
  if (yieldInfo.quantity == null || Number(yieldInfo.quantity) <= 0 || !yieldInfo.unit) {
    errors.push({ code: RECIPE_VALIDITY_CODE.INVALID_OUTPUT, bucket: RECIPE_VALIDITY.BLOCKED_DATA_QUALITY, reason: "Recipe yield quantity and unit are required" });
  }
  const versionLines = (lines || []).filter((line) => (line.recipe_version_id || line.recipeVersionId) === version?.id);
  const analytical = analyticalRecipeLines(versionLines, ingredientById);
  if (!analytical.length) {
    errors.push({ code: RECIPE_VALIDITY_CODE.EMPTY_RECIPE, bucket: RECIPE_VALIDITY.BLOCKED_DATA_QUALITY, reason: "No analytical ingredient or sub-recipe lines" });
  }

  const visiting = new Set();
  const walk = (recipeId, versionId, path) => {
    if (path.has(recipeId)) {
      errors.push({ code: RECIPE_VALIDITY_CODE.RECIPE_CYCLE, bucket: RECIPE_VALIDITY.BLOCKED_DATA_QUALITY, reason: "Recipe graph contains a cycle", recipeId });
      return;
    }
    if (visiting.has(recipeId)) return;
    visiting.add(recipeId);
    const nextPath = new Set(path);
    nextPath.add(recipeId);
    const versionLines = (lines || []).filter((line) => (line.recipe_version_id || line.recipeVersionId) === versionId);
    for (const line of versionLines) {
      const kind = classifyRecipeLineKind(line, {
        ingredientName: ingredientById.get(line.ingredient_id || line.ingredientId)?.canonical_name
          || ingredientById.get(line.ingredient_id || line.ingredientId)?.canonicalName,
      });
      if (kind === RECIPE_LINE_KIND.DOCUMENTATION_LINE) continue;
      const qty = Number(line.quantity);
      if (!(qty > 0)) {
        errors.push({ code: RECIPE_VALIDITY_CODE.INVALID_QUANTITY, bucket: RECIPE_VALIDITY.BLOCKED_DATA_QUALITY, lineId: lineId(line), reason: "Quantity must be greater than zero" });
        continue;
      }
      const subId = line.sub_recipe_id || line.subRecipeId;
      const ingredientId = line.ingredient_id || line.ingredientId;
      if (subId) {
        const nestedRecipe = recipeById.get(subId);
        const nestedVersions = (versions || []).filter((item) => item.recipe_id === subId);
        const nestedActive = nestedVersions.filter((item) => statusOf(item) === "active");
        if (!nestedRecipe) {
          errors.push({
            code: RECIPE_VALIDITY_CODE.INVALID_SUBRECIPE_VERSION_OR_UNIT,
            bucket: RECIPE_VALIDITY.BLOCKED_SUBRECIPE,
            lineId: lineId(line),
            reason: "Nested recipe is missing",
          });
          continue;
        }
        if (nestedActive.length !== 1) {
          errors.push({
            code: RECIPE_VALIDITY_CODE.INVALID_SUBRECIPE_VERSION_OR_UNIT,
            bucket: RECIPE_VALIDITY.BLOCKED_SUBRECIPE,
            lineId: lineId(line),
            reason: `${nestedRecipe.name || "Sub-recipe"} has no active version`,
          });
          continue;
        }
        const nestedYield = recipeYield(nestedRecipe, nestedActive[0]);
        const converted = resolveRecipeLineUom({
          quantity: line.quantity,
          unit: line.unit || line.canonical_unit || line.canonicalUnit,
          baseUom: nestedYield.unit,
        });
        if (converted.conversionStatus !== CONVERSION_STATUS.EXACT && converted.conversionStatus !== CONVERSION_STATUS.CONVERTED) {
          errors.push({
            code: RECIPE_VALIDITY_CODE.INCOMPATIBLE_UOM,
            bucket: RECIPE_VALIDITY.BLOCKED_UOM,
            lineId: lineId(line),
            reason: `${nestedRecipe.name || "Sub-recipe"} yield ${nestedYield.unit} is incompatible with line unit ${line.unit}`,
          });
          continue;
        }
        walk(subId, nestedActive[0].id, nextPath);
        continue;
      }
      if (!ingredientId) {
        errors.push({
          code: RECIPE_VALIDITY_CODE.MISSING_IDENTITY,
          bucket: RECIPE_VALIDITY.BLOCKED_IDENTITY,
          lineId: lineId(line),
          reason: "Line has neither ingredient nor sub-recipe",
        });
        continue;
      }
      const ingredient = ingredientById.get(ingredientId);
      const readiness = classifyIngredientReadiness(ingredient, line);
      if (readiness.documentation) continue;
      if (!readiness.ok) {
        errors.push({ ...readiness, lineId: lineId(line) });
        continue;
      }
      if (!line.unit) {
        errors.push({
          code: RECIPE_VALIDITY_CODE.MISSING_UOM,
          bucket: RECIPE_VALIDITY.BLOCKED_UOM,
          lineId: lineId(line),
          reason: "Line unit is required",
        });
        continue;
      }
      const converted = resolveRecipeLineUom({
        quantity: line.quantity,
        unit: line.unit,
        baseUom: ingredient?.base_inventory_unit || ingredient?.baseInventoryUnit,
        verifiedConversionFactor: line.verified_conversion_factor || line.verifiedConversionFactor || null,
      });
      if (converted.conversionStatus !== CONVERSION_STATUS.EXACT && converted.conversionStatus !== CONVERSION_STATUS.CONVERTED) {
        errors.push({
          code: converted.conversionStatus === CONVERSION_STATUS.INCOMPATIBLE
            ? RECIPE_VALIDITY_CODE.INCOMPATIBLE_UOM
            : converted.conversionStatus,
          bucket: RECIPE_VALIDITY.BLOCKED_UOM,
          lineId: lineId(line),
          reason: `${ingredient?.canonical_name || ingredient?.canonicalName || "ingredient"} ${line.unit} cannot convert to ${ingredient?.base_inventory_unit || ingredient?.baseInventoryUnit}`,
        });
      }
    }
  };

  if (version?.id) walk(recipe?.id, version.id, new Set());

  if (requireActivationPolicy) {
    if (!String(activationReason || "").trim()) {
      errors.push({
        code: RECIPE_VALIDITY_CODE.ACTIVATION_REASON_REQUIRED,
        bucket: RECIPE_VALIDITY.BLOCKED_OTHER,
        reason: "Activation requires an operational reason",
      });
    }
    if (!hasOperationalAcknowledgement(documentation, { sourceClass })) {
      errors.push({
        code: RECIPE_VALIDITY_CODE.SOURCE_ACKNOWLEDGEMENT_REQUIRED,
        bucket: RECIPE_VALIDITY.BLOCKED_OTHER,
        reason: "Operationally modified from source — acknowledge the diff before activating",
      });
    }
  }

  const unique = errors.filter((item, index) => (
    errors.findIndex((other) => other.code === item.code && other.reason === item.reason && other.lineId === item.lineId) === index
  ));
  const status = unique.length
    ? unique.map((item) => item.bucket).find((bucket) => bucket !== RECIPE_VALIDITY.BLOCKED_OTHER) || unique[0].bucket
    : RECIPE_VALIDITY.VALID;
  return {
    valid: unique.length === 0,
    status: unique.length ? status : RECIPE_VALIDITY.VALID,
    errors: unique,
    productionWouldUseCostEligibleGate: PRODUCTION_SQL_GATES.requiresRecipeCostEligible,
  };
}

export function summarizeValidityStatus(errors = []) {
  if (!errors.length) return RECIPE_VALIDITY.VALID;
  return errors[0].bucket || bucketForCode(errors[0].code);
}
