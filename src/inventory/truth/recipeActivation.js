import { ACTIVATION_DECISION } from "./readinessContracts";
import { classifyBlockedRecipe } from "./readinessAudit";
import { applySourceEvidenceToRecipeRow, compareDraftToSource } from "./sourceEvidence";
import { resolveSupersededDrafts } from "./draftCandidates";
import defaultSourceCatalog from "./sourceEvidence.catalog.json";
import { evaluateCanonicalRecipeValidity } from "./recipeValidityContract";

function statusOf(version) {
  return String(version?.status || "").toLowerCase();
}

export function mustForkNewDraft(status) {
  return String(status || "").toLowerCase() !== "draft";
}

export function applyActivationPlan(versions = [], plan) {
  if (!plan?.activateVersionId) {
    throw new Error("Activation target missing");
  }
  const byId = new Map((versions || []).map((version) => [version.id, { ...version }]));
  for (const write of plan.writes || []) {
    const row = byId.get(write.id);
    if (!row) throw new Error("Activation aborted: version missing");
    Object.assign(row, write.patch);
  }
  const next = [...byId.values()];
  const actives = next.filter((version) => (
    version.recipe_id === plan.recipeId && String(version.status || "").toLowerCase() === "active"
  ));
  if (actives.length !== 1) {
    throw new Error("Activation aborted: single active invariant");
  }
  return next;
}

export function planActivateRecipeVersion({
  recipeId,
  activateVersionId,
  versions = [],
  reason = "source_confirmed_activation",
  source = "food_bible",
  validation = {},
} = {}) {
  const currentActive = (versions || []).filter((version) => (
    version.recipe_id === recipeId && statusOf(version) === "active" && version.id !== activateVersionId
  ));
  return {
    recipeId,
    activateVersionId,
    retireVersionIds: currentActive.map((version) => version.id),
    executed: false,
    reason,
    source,
    validation,
    writes: [
      ...currentActive.map((version) => ({
        table: "inventory_recipe_versions",
        id: version.id,
        patch: { status: "retired" },
      })),
      { table: "inventory_recipe_versions", id: activateVersionId, patch: { status: "active" } },
    ],
    reverseWrites: [
      { table: "inventory_recipe_versions", id: activateVersionId, patch: { status: "draft" } },
      ...currentActive.map((version) => ({
        table: "inventory_recipe_versions",
        id: version.id,
        patch: { status: "active" },
      })),
    ],
  };
}

export function validateRecipeVersionForActivation({
  recipe,
  versions = [],
  lines = [],
  ingredients = [],
  allRecipes = [],
  menuItems = [],
  salesRows = [],
  sourceCatalog = defaultSourceCatalog,
  activationReason = "",
  requireActivationPolicy = false,
  documentation = {},
} = {}) {
  const resolved = resolveSupersededDrafts({ recipeId: recipe.id, versions, lines, ingredients });
  const classified = classifyBlockedRecipe({
    recipe,
    versions,
    allRecipes,
    allVersions: versions,
    lines,
    ingredients,
    menuItems,
    salesRows,
  });
  const ingredientById = new Map((ingredients || []).map((row) => [row.id, row]));
  const recipeById = new Map((allRecipes || []).map((row) => [row.id, row]));
  const candidateId = classified.candidate?.versionId;
  const draftLines = (lines || [])
    .filter((line) => (line.recipe_version_id || line.recipeVersionId) === candidateId)
    .map((line) => ({
      name: ingredientById.get(line.ingredient_id || line.ingredientId)?.canonical_name
        || recipeById.get(line.sub_recipe_id || line.subRecipeId)?.name
        || null,
      qty: line.quantity,
      unit: line.unit,
    }));
  const evidence = compareDraftToSource({
    recipeName: classified.recipeName,
    soldDisplayName: classified.soldDisplayName,
    draftLines,
    catalog: sourceCatalog,
  });
  const row = applySourceEvidenceToRecipeRow(classified, evidence);
  const candidateVersion = (versions || []).find((version) => version.id === candidateId)
    || (candidateId ? { id: candidateId, documentation } : null);
  const canonical = evaluateCanonicalRecipeValidity({
    recipe,
    version: candidateVersion,
    versions,
    lines,
    ingredients,
    allRecipes: allRecipes.length ? allRecipes : [recipe],
    sourceClass: evidence.class,
    documentation: candidateVersion?.documentation || documentation,
    activationReason,
    requireActivationPolicy,
  });
  const blockers = [
    ...(row.structuralIssues || []),
    ...canonical.errors,
  ];
  if (row.decision !== ACTIVATION_DECISION.SAFE_TO_ACTIVATE) {
    blockers.push({ code: row.class, reason: row.reason });
  }
  const uniqueBlockers = blockers.filter((item, index) => (
    blockers.findIndex((other) => other.code === item.code && other.reason === item.reason) === index
  ));
  const alreadyActive = classified.class === "ANALYTICAL_OK";
  const ok = !alreadyActive && canonical.valid && row.decision === ACTIVATION_DECISION.SAFE_TO_ACTIVATE;
  return {
    ok,
    alreadyActive,
    row: { ...row, validityStatus: canonical.status },
    evidence,
    supersededDrafts: resolved.superseded,
    blockers: ok ? [] : uniqueBlockers,
    conversionNotes: canonical.conversionNotes || [],
    plan: planActivateRecipeVersion({
      recipeId: recipe.id,
      activateVersionId: candidateId,
      versions,
      validation: { decision: row.decision, sourceClass: row.sourceClass, validityStatus: canonical.status },
    }),
  };
}

export const REVIEWED_SOLD_ACTIVATION_NAMES = Object.freeze([
  "RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO",
  "SUMAC CHICKEN",
  "TRUFFLE BURGER, MONTERREY JACK, TRUFFLE MAYO",
  "TRUFFLED MAC & CHEESE",
  "SHAKSHUKA POACHED EGGS, FETA, ZA'ATAR, PITA",
]);
