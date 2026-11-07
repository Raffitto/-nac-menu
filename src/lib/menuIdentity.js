import registry from "./data/nacMenuIdentities.json";

export const CONFIRMED_MENU_VARIANTS = registry.variants;

/** Exact observed placement IDs only. Labels, prices and calories are editable presentation. */
export function isKnownMenuPlacementId(id) {
  return CONFIRMED_MENU_VARIANTS.some((variant) => variant.placementIds.includes(id));
}

export function resolveConfirmedMenuIdentity(item) {
  if (!item?.id) return null;
  const matches = CONFIRMED_MENU_VARIANTS.filter((variant) => variant.placementIds.includes(item.id));
  if (matches.length !== 1) return null;
  const identity = matches[0];
  if (item.branch_id && item.branch_id !== identity.sourceBranchId) return null;
  if (item.foodics_product_id && item.foodics_product_id !== identity.foodicsProductId) return null;
  const declaredSku = item.foodics_sku || item.product_sku;
  if (declaredSku && declaredSku !== identity.foodicsSku) return null;
  return identity;
}

export function isConfirmedHistoricalBigNac(item) {
  return item?.foodics_product_id === "99d6f9bd-434f-4289-8972-62b9781ee8cc";
}
