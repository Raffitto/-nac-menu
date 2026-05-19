function itemLabel(row) {
  return (
    row.matched_menu_item_name ||
    row.raw_item_name ||
    row.product_name ||
    row.item_name ||
    ""
  ).trim();
}

function itemKey(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Unique sellable items from Foodics imports for weekly focus picker */
export function buildFocusItemCatalog(productItems = [], waiterItems = []) {
  const map = new Map();

  [...(productItems || []), ...(waiterItems || [])].forEach((row) => {
    const label = itemLabel(row);
    if (!label) return;
    const key = itemKey(label);
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        label,
        isModifier: Boolean(
          row.is_modifier ||
            row.track_as_modifier ||
            ["modifier", "sauce_condiment", "addon"].includes(row.semantic_class),
        ),
      });
    }
  });

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function matchFocusItem(label, focusItems = []) {
  const key = itemKey(label);
  if (!key || !focusItems?.length) return null;
  for (const focus of focusItems) {
    const fk = itemKey(focus);
    if (key === fk || key.includes(fk) || fk.includes(key)) return focus;
  }
  return null;
}

export { itemKey, itemLabel };
