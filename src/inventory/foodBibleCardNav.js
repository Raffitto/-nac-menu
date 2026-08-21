export function pushCardTarget(stack, target) {
  if (!target) return stack || [];
  return [...(stack || []), target];
}

export function popCardTarget(stack) {
  const current = stack || [];
  if (current.length <= 1) return [];
  return current.slice(0, -1);
}

export function cardBreadcrumb(stack) {
  return (stack || []).map((entry) => entry.displayName || entry.name || "Recipe").filter(Boolean);
}

export function componentOpenTarget(parent, component) {
  return {
    recipeId: component.id || component.recipeId,
    displayName: component.name || component.displayName,
    kind: "component",
    recipeType: "preparation",
  };
}
