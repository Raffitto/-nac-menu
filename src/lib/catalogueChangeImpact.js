import { catalogueIdentityId, resolveCatalogueIdentity } from "./catalogueIdentity";
import { canonicalPlacementKey } from "./canonicalGuestCatalogue";

const SHARED_FIELDS = new Set([
  "name_en", "name_ar", "desc_en", "desc_ar", "price", "calories", "image",
]);
const AVAILABILITY_FIELDS = new Set(["active", "hidden_until", "sold_out"]);

function uniqueIds(rows) {
  return [...new Set((rows || []).map((row) => row?.id).filter(Boolean))];
}

/**
 * Placements the current save path can update, using only rows passed in.
 * Mirrors placement-group members plus same-branch, same-price name siblings.
 * Other branches are not pulled in by name.
 */
export function linkedPlacementIds(item, placements = []) {
  if (!item?.id) return [];
  const ids = new Set([item.id]);
  const groupId = catalogueIdentityId(item);
  if (groupId) {
    for (const row of placements) {
      if (catalogueIdentityId(row) === groupId && row.id) ids.add(row.id);
    }
  }
  const key = canonicalPlacementKey(item);
  const branchId = item.branch_id || item.branchId;
  if (key && branchId) {
    for (const row of placements) {
      const rowBranch = row.branch_id || row.branchId;
      if (rowBranch === branchId && canonicalPlacementKey(row) === key && row.id) ids.add(row.id);
    }
  }
  return [...ids];
}

function loadedCount(rows, predicate) {
  if (!Array.isArray(rows)) return { status: "not_loaded" };
  return { status: "counted", count: rows.filter(predicate).length };
}

/**
 * Impact of a draft edit. Counts come only from the records supplied.
 * Does not write, publish, or fill missing relationships with zero.
 */
export function buildCatalogueChangeImpact({
  placement,
  placements,
  recipes,
  foodicsMappings,
  allergenIds,
  salesRows,
  field = "desc_en",
} = {}) {
  const identity = resolveCatalogueIdentity(placement || {});
  const loadedPlacements = Array.isArray(placements) ? placements : [];
  const targets = placement?.id ? linkedPlacementIds(placement, loadedPlacements) : [];
  const branches = [...new Set(
    loadedPlacements
      .filter((row) => targets.includes(row.id))
      .map((row) => row.branch_id || row.branchId)
      .filter(Boolean),
  )];
  const groupId = identity.catalogueId;
  const approvedRecipes = loadedCount(
    recipes,
    (recipe) => targets.includes(recipe.menu_item_id)
      && String(recipe.status || recipe.version_status || "active").toLowerCase() !== "draft"
      && recipe.active !== false,
  );
  const draftRecipes = loadedCount(
    recipes,
    (recipe) => targets.includes(recipe.menu_item_id)
      && String(recipe.status || recipe.version_status || "").toLowerCase() === "draft",
  );
  const foodics = loadedCount(
    foodicsMappings,
    (row) => targets.includes(row.menu_item_id) || (groupId && row.catalogue_id === groupId),
  );
  const sales = Array.isArray(salesRows)
    ? salesRows.filter((row) => targets.includes(row.matched_menu_item_id) || targets.includes(row.menu_item_id)).length
    : null;

  const availabilityChange = AVAILABILITY_FIELDS.has(field);
  const sharedChange = SHARED_FIELDS.has(field);

  return {
    publishes: false,
    productName: placement?.name_en || placement?.en || "Menu item",
    identity,
    lines: [
      {
        id: "guest",
        label: "Guest placements in the loaded catalogue",
        value: Array.isArray(placements) ? String(targets.length) : "not loaded",
      },
      {
        id: "branches",
        label: "Branches on those loaded placements",
        value: Array.isArray(placements) ? String(branches.length) : "not loaded",
      },
      {
        id: "catalogue",
        label: "Canonical product",
        value: groupId || "not linked — this row stays a placement until a placement group exists",
      },
      {
        id: "recipes",
        label: "Approved recipe links",
        value: approvedRecipes.status === "counted" ? String(approvedRecipes.count) : "not loaded",
      },
      {
        id: "drafts",
        label: "Draft recipes",
        value: draftRecipes.status === "counted"
          ? `${draftRecipes.count} remain unpublished`
          : "not loaded",
      },
      {
        id: "foodics",
        label: "Foodics mappings",
        value: foodics.status === "counted"
          ? `${foodics.count} linked — POS records are not modified`
          : "not loaded",
      },
      {
        id: "allergens",
        label: "Allergens on this placement",
        value: Array.isArray(allergenIds) ? String(allergenIds.length) : "not loaded",
      },
      {
        id: "history",
        label: "Historical transactions",
        value: sales == null ? "unchanged — sales rows were not loaded" : `unchanged — ${sales} loaded rows stay as stored`,
      },
      {
        id: "availability",
        label: "Branch availability",
        value: availabilityChange
          ? "this change stays on the loaded same-branch placements"
          : sharedChange
            ? "unchanged by this content edit"
            : "unchanged",
      },
    ],
  };
}

export function propagationTargetIds(item, placements, field) {
  if (AVAILABILITY_FIELDS.has(field)) {
    const branchId = item?.branch_id || item?.branchId;
    return linkedPlacementIds(item, placements).filter((id) => {
      const row = placements.find((entry) => entry.id === id);
      return !row || (row.branch_id || row.branchId) === branchId || id === item.id;
    });
  }
  if (SHARED_FIELDS.has(field)) return linkedPlacementIds(item, placements);
  return uniqueIds([item]);
}
