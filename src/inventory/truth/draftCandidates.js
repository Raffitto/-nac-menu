import { analyticalRecipeLines } from "./recipeLineKind";

function statusOf(version) {
  return String(version?.status || "").toLowerCase();
}

function lineKey(line) {
  const sub = line.sub_recipe_id || line.subRecipeId;
  if (sub) return `sub:${sub}`;
  const ingredientId = line.ingredient_id || line.ingredientId;
  if (ingredientId) return `ing:${ingredientId}`;
  return `name:${String(line.name || "").toLowerCase()}`;
}

export function resolveSupersededDrafts({ recipeId = null, versions = [], lines = [], ingredients = [] } = {}) {
  const ingredientById = new Map((ingredients || []).map((row) => [row.id, row]));
  const drafts = (recipeId
    ? (versions || []).filter((version) => version.recipe_id === recipeId)
    : (versions || []))
    .filter((version) => statusOf(version) === "draft")
    .sort((left, right) => Number(left.version_number || 0) - Number(right.version_number || 0));
  const withLines = drafts.filter((version) => (
    analyticalRecipeLines(
      (lines || []).filter((line) => (line.recipe_version_id || line.recipeVersionId) === version.id),
      ingredientById,
    ).length
  ));
  if (withLines.length <= 1) {
    return { current: withLines[0] || drafts[0] || null, superseded: [], competing: withLines };
  }
  const current = withLines[withLines.length - 1];
  const currentKeys = new Set(
    analyticalRecipeLines(
      (lines || []).filter((line) => (line.recipe_version_id || line.recipeVersionId) === current.id),
      ingredientById,
    ).map(lineKey),
  );
  const superseded = [];
  const competing = [];
  for (const version of withLines.slice(0, -1)) {
    const keys = analyticalRecipeLines(
      (lines || []).filter((line) => (line.recipe_version_id || line.recipeVersionId) === version.id),
      ingredientById,
    ).map(lineKey);
    const subset = keys.length && keys.every((key) => currentKeys.has(key)) && keys.length < currentKeys.size;
    if (subset) superseded.push(version);
    else competing.push(version);
  }
  competing.push(current);
  return { current, superseded, competing };
}
