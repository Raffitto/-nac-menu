/**
 * Cash Up remains canonical for management headline sales.
 * Foodics/commerce facts are canonical for mix, baskets, and archetypes.
 * Differences are metadata, never automatic errors.
 */

export type SalesReconciliation = {
  branchId: string;
  businessDate: string;
  cashUpSales: number | null;
  foodicsSales: number | null;
  absoluteDifference: number | null;
  percentageDifference: number | null;
  equalProven: boolean;
};

export function reconcileHeadlineSales(input: {
  branchId: string;
  businessDate: string;
  cashUpSales?: number | null;
  foodicsSales?: number | null;
}): SalesReconciliation {
  const cash = input.cashUpSales ?? null;
  const foodics = input.foodicsSales ?? null;
  let absoluteDifference: number | null = null;
  let percentageDifference: number | null = null;
  if (cash != null && foodics != null) {
    absoluteDifference = cash - foodics;
    percentageDifference = cash === 0 ? null : (absoluteDifference / cash) * 100;
  }
  return {
    branchId: input.branchId,
    businessDate: input.businessDate,
    cashUpSales: cash,
    foodicsSales: foodics,
    absoluteDifference,
    percentageDifference,
    equalProven: cash != null && foodics != null && Math.abs(cash - foodics) < 0.005,
  };
}
