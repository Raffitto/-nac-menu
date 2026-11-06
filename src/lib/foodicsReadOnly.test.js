import {
  FOODICS_READONLY_SNAPSHOT,
  LIVE_FOODICS_OBSERVATIONS,
  activeFrenchToastProducts,
  foodicsRecordsShareIdentity,
} from "./foodicsReadOnly";

describe("live Foodics read", () => {
  test("a product SKU that also labels an inventory item is not one identity", () => {
    const product = { entityType: "finished_product", id: "a2d0c0a0-ef7e-451c-af2e-976c293bda26", sku: "sk-2534", name: "Ginger Ale" };
    const supply = { entityType: "inventory_item", id: "a23fc57a-063d-4032-bd7b-c46b6032927f", sku: "sk-2534", name: "HIT STAINLESS STRAINER" };
    expect(product.sku).toBe(supply.sku);
    expect(foodicsRecordsShareIdentity(product, supply)).toBe(false);
    expect(FOODICS_READONLY_SNAPSHOT.skuOverlapsDifferentName).toBe(459);
    expect(FOODICS_READONLY_SNAPSHOT.skuOverlapsSameName).toBe(0);
  });

  test("two active French Toast products stay separate", () => {
    const rows = activeFrenchToastProducts();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.sku)).size).toBe(2);
    const guestMatch = LIVE_FOODICS_OBSERVATIONS.find((row) => row.sku === "sk-0647");
    expect(guestMatch.priceSar).toBe(55);
    expect(guestMatch.calories).toBe(462);
  });
});