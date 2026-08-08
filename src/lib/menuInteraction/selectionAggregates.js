import { isHiddenFromPublicMenu } from "../menuVisibility";

/**
 * Aggregate canonical state for a multi-selection dock.
 * @returns {{
 *   visibilityMode: 'visible'|'hidden'|'mixed',
 *   soldOutMode: 'available'|'sold_out'|'mixed',
 *   visibilityLabel: string,
 *   soldOutLabel: string,
 * }}
 */
export function summarizeSelectionAggregates(items = [], nowMs = Date.now()) {
  let visible = 0;
  let hidden = 0;
  let soldOut = 0;
  let available = 0;

  (items || []).forEach((item) => {
    if (isHiddenFromPublicMenu(item, nowMs)) hidden += 1;
    else visible += 1;
    if (item?.sold_out) soldOut += 1;
    else available += 1;
  });

  const visibilityMode =
    items.length === 0
      ? "visible"
      : hidden === 0
        ? "visible"
        : visible === 0
          ? "hidden"
          : "mixed";

  const soldOutMode =
    items.length === 0
      ? "available"
      : soldOut === 0
        ? "available"
        : available === 0
          ? "sold_out"
          : "mixed";

  return {
    visibilityMode,
    soldOutMode,
    visibilityLabel:
      visibilityMode === "visible"
        ? "Hide"
        : visibilityMode === "hidden"
          ? "Show"
          : "Visibility…",
    soldOutLabel:
      soldOutMode === "available"
        ? "Sold Out"
        : soldOutMode === "sold_out"
          ? "Available"
          : "Status…",
  };
}
