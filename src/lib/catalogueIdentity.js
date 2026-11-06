/**
 * Finished-menu identity for NAC.
 * menu_items.id is one placement. placement_group_id links sections of that
 * dish inside a branch. Branch clones receive a new group id, so this is not
 * a four-branch product id. No network catalogue column exists yet.
 * Names, prices, and Foodics labels are not relationship keys.
 */

export const CATALOGUE_ENTITY = Object.freeze({
  FINISHED_PRODUCT: "finished_product",
  PLACEMENT: "placement",
  RECIPE: "recipe",
  RECIPE_VERSION: "recipe_version",
  INGREDIENT: "ingredient",
  FOODICS_PRODUCT: "foodics_product",
});

export function catalogueIdentityId(item) {
  const id = item?.placement_group_id || item?.placementGroupId || null;
  return id ? String(id) : null;
}

export function describeCatalogueEntity(record = {}) {
  if (record.recipe_version_id || (record.version_number != null && record.recipe_id)) {
    return CATALOGUE_ENTITY.RECIPE_VERSION;
  }
  if (record.recipe_type || (record.normalized_name && record.menu_item_id)) {
    return CATALOGUE_ENTITY.RECIPE;
  }
  if (record.base_inventory_unit || record.canonical_name) {
    return CATALOGUE_ENTITY.INGREDIENT;
  }
  if (record.foodics_name || record.normalized_key) {
    return CATALOGUE_ENTITY.FOODICS_PRODUCT;
  }
  if (record.placement_group_id || record.section_id) {
    return catalogueIdentityId(record) ? CATALOGUE_ENTITY.FINISHED_PRODUCT : CATALOGUE_ENTITY.PLACEMENT;
  }
  return CATALOGUE_ENTITY.PLACEMENT;
}

/**
 * Identity for one placement. Unlinked rows stay unlinked.
 * catalogueId is the placement group only. networkCatalogueId stays null
 * until a real cross-branch column exists. Names never become that id.
 */
export function resolveCatalogueIdentity(item) {
  const placementId = item?.id ? String(item.id) : null;
  const placementGroupId = catalogueIdentityId(item);
  return {
    entity: placementGroupId ? CATALOGUE_ENTITY.FINISHED_PRODUCT : CATALOGUE_ENTITY.PLACEMENT,
    placementId,
    placementGroupId,
    catalogueId: placementGroupId,
    networkCatalogueId: null,
    branchId: item?.branch_id || item?.branchId || null,
    status: placementGroupId ? "placement_group" : "unlinked",
  };
}
