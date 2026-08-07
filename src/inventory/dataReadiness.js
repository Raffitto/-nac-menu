export const COVERAGE_STATUS = Object.freeze({
  ALL: "ALL",
  MISSING_RECIPE: "MISSING_RECIPE",
  INCOMPLETE_RECIPE: "INCOMPLETE_RECIPE",
  MISSING_INGREDIENT_MAP: "MISSING_INGREDIENT_MAP",
  MISSING_COST: "MISSING_COST",
  TRUSTED: "TRUSTED",
  DIRECT_STOCK: "DIRECT_STOCK",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  EXCLUDED: "EXCLUDED",
});

export const COSTING_INTENTS = Object.freeze([
  { value: "recipe_required", label: "Recipe required" },
  { value: "direct_stock", label: "Direct stock" },
  { value: "modifier_addon", label: "Modifier / add-on" },
  { value: "free_non_cost_bearing", label: "Free / non-cost-bearing" },
  { value: "composite_prep", label: "Composite / prep" },
  { value: "intentionally_excluded", label: "Intentionally excluded" },
  { value: "unresolved", label: "Unresolved" },
]);

export const COVERAGE_FILTERS = Object.freeze([
  { value: COVERAGE_STATUS.ALL, label: "All" },
  { value: COVERAGE_STATUS.MISSING_RECIPE, label: "Missing recipe" },
  { value: COVERAGE_STATUS.INCOMPLETE_RECIPE, label: "Incomplete recipe" },
  { value: COVERAGE_STATUS.MISSING_INGREDIENT_MAP, label: "Missing ingredient map" },
  { value: COVERAGE_STATUS.MISSING_COST, label: "Missing cost" },
  { value: COVERAGE_STATUS.TRUSTED, label: "Trusted" },
  { value: COVERAGE_STATUS.DIRECT_STOCK, label: "Direct stock" },
  { value: COVERAGE_STATUS.NEEDS_REVIEW, label: "Needs review" },
]);

export function filterCoverageProducts(
  products,
  { status = COVERAGE_STATUS.ALL, search = "" } = {},
) {
  const needle = String(search).trim().toLowerCase();
  return (products || []).filter((product) => {
    if (status !== COVERAGE_STATUS.ALL && product.coverageStatus !== status) return false;
    if (!needle) return true;
    return [
      product.name,
      product.nameAr,
      product.category,
      product.section,
      product.recipeName,
    ].some((value) => String(value || "").toLowerCase().includes(needle));
  });
}

export function prioritizeRecipeWork(products, { limit = 15 } = {}) {
  const grouped = [...(products || []).reduce((groups, product) => {
    const key = product.placementGroupId || product.menuItemId || product.name;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...product });
    } else {
      existing.soldUnits = Number(existing.soldUnits || 0) + Number(product.soldUnits || 0);
      existing.salesValue = Number(existing.salesValue || 0) + Number(product.salesValue || 0);
      if (product.coverageStatus === COVERAGE_STATUS.TRUSTED) {
        existing.coverageStatus = COVERAGE_STATUS.TRUSTED;
      }
    }
    return groups;
  }, new Map()).values()];

  const candidates = grouped
    .filter((product) => ![
      COVERAGE_STATUS.TRUSTED,
      COVERAGE_STATUS.DIRECT_STOCK,
      COVERAGE_STATUS.EXCLUDED,
    ].includes(product.coverageStatus))
    .map((product) => ({
      ...product,
      priorityScore: (
        Number(product.salesValue || 0) * 1000
        + Number(product.soldUnits || 0)
      ),
    }))
    .sort((left, right) => (
      right.priorityScore - left.priorityScore
      || String(left.name).localeCompare(String(right.name))
    ));

  const totalUnits = grouped.reduce(
    (sum, product) => sum + Number(product.soldUnits || 0),
    0,
  );
  const trustedUnits = grouped
    .filter((product) => product.coverageStatus === COVERAGE_STATUS.TRUSTED)
    .reduce((sum, product) => sum + Number(product.soldUnits || 0), 0);
  const selected = candidates.slice(0, limit);
  const selectedUnits = selected.reduce(
    (sum, product) => sum + Number(product.soldUnits || 0),
    0,
  );

  return {
    products: selected,
    currentUnitCoveragePct: totalUnits > 0
      ? Number(((trustedUnits / totalUnits) * 100).toFixed(2))
      : null,
    projectedUnitCoveragePct: totalUnits > 0
      ? Number((((trustedUnits + selectedUnits) / totalUnits) * 100).toFixed(2))
      : null,
  };
}

export function classifyCatalogueCandidate(candidate) {
  if (candidate.candidate_status === "DUPLICATE_CANDIDATE") {
    return {
      status: "duplicate_candidate",
      canCreate: false,
      reason: candidate.duplicate_ingredient_name
        || candidate.supplier_catalogue_ingredient_name
        || "Existing canonical match requires review",
    };
  }
  if (candidate.candidate_status === "SOURCE_FINALIZED") {
    return {
      status: "needs_review",
      canCreate: false,
      reason: "The source invoice is finalized",
    };
  }
  return {
    status: "unresolved",
    canCreate: true,
    reason: "Review units and duplicate candidates before canonical creation",
  };
}

export function mergeTheoreticalConsumption(varianceResult, theoreticalResult) {
  if (!theoreticalResult || theoreticalResult.status === "NO_APPROVED_SALES_SOURCE") {
    return varianceResult;
  }
  const theoreticalByItem = new Map(
    (theoreticalResult.items || []).map((item) => [item.inventoryItemId, item]),
  );
  return {
    ...varianceResult,
    theoreticalConsumptionAvailable: theoreticalResult.complete === true,
    theoreticalConsumptionReason: theoreticalResult.complete
      ? null
      : "THEORETICAL_CONSUMPTION_PARTIAL",
    theoreticalCoverage: theoreticalResult.coverage,
    theoreticalGaps: theoreticalResult.gaps || [],
    items: (varianceResult.items || []).map((item) => {
      const theoretical = theoreticalByItem.get(item.inventoryItemId);
      if (!theoretical) return item;
      const actualOrderConsumption = Number(item.actual?.orderConsumption || 0);
      const theoreticalQuantity = Number(theoretical.theoreticalQuantity || 0);
      return {
        ...item,
        theoreticalRecipeConsumption: theoreticalQuantity,
        theoreticalConsumptionEvidence: theoretical.evidence || [],
        theoreticalConsumptionComplete: theoreticalResult.complete === true,
        consumptionVarianceQuantity: actualOrderConsumption
          ? actualOrderConsumption - theoreticalQuantity
          : null,
      };
    }),
  };
}
