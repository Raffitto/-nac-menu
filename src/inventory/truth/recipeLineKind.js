/**
 * Split Food Bible lines into analytical vs display-only documentation.
 * Documentation stays on the card; it must not enter the recipe graph.
 */

export const RECIPE_LINE_KIND = Object.freeze({
  INGREDIENT_LINE: "INGREDIENT_LINE",
  SUB_RECIPE_LINE: "SUB_RECIPE_LINE",
  DOCUMENTATION_LINE: "DOCUMENTATION_LINE",
});

const DOCUMENTATION_NAME = /^(total|portions?|finished weight|fin?ished weight|bases|except the olive oil,?|notes|timing:?.*|method|equipment|yield)$/i;

export function isDocumentationLineName(name) {
  return DOCUMENTATION_NAME.test(String(name || "").trim());
}

export function classifyRecipeLineKind(line = {}, { ingredientName = null } = {}) {
  const name = ingredientName
    || line.ingredientName
    || line.canonical_name
    || line.canonicalName
    || line.name
    || "";
  if (isDocumentationLineName(name)) return RECIPE_LINE_KIND.DOCUMENTATION_LINE;
  if (line.sub_recipe_id || line.subRecipeId) return RECIPE_LINE_KIND.SUB_RECIPE_LINE;
  if (line.ingredient_id || line.ingredientId) return RECIPE_LINE_KIND.INGREDIENT_LINE;
  return RECIPE_LINE_KIND.DOCUMENTATION_LINE;
}

export function analyticalRecipeLines(lines = [], ingredientById = new Map()) {
  return (lines || []).filter((line) => {
    const ingredient = ingredientById.get?.(line.ingredient_id || line.ingredientId)
      || ingredientById[line.ingredient_id || line.ingredientId]
      || null;
    const name = ingredient?.canonical_name || ingredient?.canonicalName || ingredient?.name || line.name;
    return classifyRecipeLineKind(line, { ingredientName: name }) !== RECIPE_LINE_KIND.DOCUMENTATION_LINE;
  });
}
