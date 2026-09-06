/**
 * Active menu identity clusters.
 *
 * Data Health 381 and Food Bible 53 are different denominators:
 * - Data Health kitchen-no-recipe counts every unlinked menu_items row
 *   that looks kitchen-expected (name/category heuristic).
 * - Food Bible live kitchen counts unique live identities after
 *   dedupeMenuItems (placement_group_id or normalized name) with
 *   guestStatus=live and requiresKitchenRecipe.
 * Duplicate rows of one dish inflate Data Health; Food Bible collapses them.
 * Food Bible "mapped" also includes inferred name matches, not only
 * inventory_recipes.menu_item_id.
 */

export function normalizeIdentityName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const CLUSTER_KIND = Object.freeze({
  BRANCH_COPY: "BRANCH_COPY",
  VARIANT: "VARIANT",
  EXACT_DUPLICATE_DEFECT: "EXACT_DUPLICATE_DEFECT",
  LEGACY_CONTAMINATION: "LEGACY_CONTAMINATION",
  SAME_LIVE_ITEM: "SAME_LIVE_ITEM",
  AMBIGUOUS: "AMBIGUOUS",
  SINGLE: "SINGLE",
});

const VARIANT_NAME = /\b(small|large|regular|portion|half|double|copy)\b/i;

export function buildIdentityClusters(menuItems = []) {
  const byName = new Map();
  for (const item of menuItems || []) {
    const key = normalizeIdentityName(item.name_en || item.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(item);
  }

  const clusters = [];
  for (const [normalizedName, rows] of byName.entries()) {
    const active = rows.filter((r) => r.active !== false);
    const inactive = rows.filter((r) => r.active === false);
    const branches = [...new Set(active.map((r) => r.branch_id || r.branchId).filter(Boolean))];
    const prices = [...new Set(active.map((r) => String(r.price ?? "")).filter((p) => p !== ""))];
    const sections = [...new Set(active.map((r) => r.section_id || r.sectionId).filter(Boolean))];
    const groups = [...new Set(active.map((r) => r.placement_group_id || r.placementGroupId).filter(Boolean))];
    const displayName = active[0]?.name_en || rows[0]?.name_en || normalizedName;

    let kind = CLUSTER_KIND.SINGLE;
    if (active.length <= 1 && inactive.length === 0) {
      kind = CLUSTER_KIND.SINGLE;
    } else if (active.length && inactive.length) {
      kind = CLUSTER_KIND.LEGACY_CONTAMINATION;
    } else if (groups.length === 1 && active.length > 1) {
      kind = CLUSTER_KIND.SAME_LIVE_ITEM;
    } else if (branches.length > 1) {
      kind = CLUSTER_KIND.BRANCH_COPY;
    } else if (VARIANT_NAME.test(normalizedName) || (prices.length > 1 && sections.length > 1)) {
      kind = CLUSTER_KIND.VARIANT;
    } else if (active.length > 1 && (branches.length <= 1) && prices.length <= 1) {
      kind = CLUSTER_KIND.EXACT_DUPLICATE_DEFECT;
    } else if (active.length > 1) {
      kind = CLUSTER_KIND.AMBIGUOUS;
    }

    clusters.push({
      normalizedName,
      displayName,
      kind,
      itemIds: rows.map((r) => r.id),
      activeItemIds: active.map((r) => r.id),
      branchIds: branches,
      prices,
      sectionIds: sections,
      placementGroupIds: groups,
      activeCount: active.length,
      inactiveCount: inactive.length,
      members: rows.map((r) => ({
        id: r.id,
        name: r.name_en || r.name,
        active: r.active !== false,
        branchId: r.branch_id || r.branchId || null,
        price: r.price ?? null,
        sectionId: r.section_id || r.sectionId || null,
        placementGroupId: r.placement_group_id || r.placementGroupId || null,
      })),
    });
  }

  const duplicateClusters = clusters.filter((c) => c.activeCount > 1);
  return {
    clusters,
    duplicateClusters,
    duplicateClusterCount: duplicateClusters.length,
    rowsInsideDuplicateClusters: duplicateClusters.reduce((n, c) => n + c.activeCount, 0),
    branchCopyCount: clusters.filter((c) => c.kind === CLUSTER_KIND.BRANCH_COPY).length,
    exactDefectCount: clusters.filter((c) => c.kind === CLUSTER_KIND.EXACT_DUPLICATE_DEFECT).length,
    variantCount: clusters.filter((c) => c.kind === CLUSTER_KIND.VARIANT).length,
    legacyContaminationCount: clusters.filter((c) => c.kind === CLUSTER_KIND.LEGACY_CONTAMINATION).length,
    sameLiveItemCount: clusters.filter((c) => c.kind === CLUSTER_KIND.SAME_LIVE_ITEM).length,
    ambiguousClusterCount: clusters.filter((c) => c.kind === CLUSTER_KIND.AMBIGUOUS).length,
  };
}

export function clusterByNormalizedName(clusters = []) {
  return new Map((clusters || []).map((c) => [c.normalizedName, c]));
}
