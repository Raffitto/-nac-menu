/**
 * Cash Up remains canonical for management headline sales.
 * Foodics/commerce facts are canonical for mix, baskets, and archetypes.
 * Differences are metadata, never automatic errors.
 */

export type ReconciliationCoverage = "both" | "cash_up_only" | "foodics_only" | "missing";

export type SalesReconciliation = {
  branchId: string;
  businessDate: string;
  cashUpSales: number | null;
  foodicsSales: number | null;
  foodicsIncVat?: number | null;
  absoluteDifference: number | null;
  percentageDifference: number | null;
  equalProven: boolean;
  coverage: ReconciliationCoverage;
  health: "ok" | "warning" | "unavailable";
  note: string;
};

const VAT_NOTE =
  "Cash Up net sales are management headline figures (typically ex-VAT). Foodics check totals are typically tax-inclusive (~15% VAT). Compare Cash Up to Foodics subtotal, not to replace either source.";

export function reconcileHeadlineSales(input: {
  branchId: string;
  businessDate: string;
  cashUpSales?: number | null;
  foodicsSales?: number | null;
  foodicsIncVat?: number | null;
}): SalesReconciliation {
  const cash = input.cashUpSales ?? null;
  const foodics = input.foodicsSales ?? null;
  let absoluteDifference: number | null = null;
  let percentageDifference: number | null = null;
  if (cash != null && foodics != null) {
    absoluteDifference = cash - foodics;
    percentageDifference = cash === 0 ? null : (absoluteDifference / cash) * 100;
  }
  const coverage: ReconciliationCoverage = cash != null && foodics != null
    ? "both"
    : cash != null ? "cash_up_only"
      : foodics != null ? "foodics_only"
        : "missing";
  let health: SalesReconciliation["health"] = "unavailable";
  if (coverage === "both") {
    health = percentageDifference != null && Math.abs(percentageDifference) > 3 ? "warning" : "ok";
  }
  return {
    branchId: input.branchId,
    businessDate: input.businessDate,
    cashUpSales: cash,
    foodicsSales: foodics,
    foodicsIncVat: input.foodicsIncVat ?? null,
    absoluteDifference,
    percentageDifference,
    equalProven: cash != null && foodics != null && Math.abs(cash - foodics) < 0.05,
    coverage,
    health,
    note: VAT_NOTE,
  };
}
