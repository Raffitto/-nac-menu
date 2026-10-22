import { scoreVaultOperationalReviewIntent } from "./vaultOperationalReviewRouting";

describe("operational period comparison routing", () => {
  test("prioritizes dated logbook comparison over generic sales", () => {
    expect(scoreVaultOperationalReviewIntent("Compare October 1-7 vs October 8-14 operational issues in Khobar")).toBe(45);
  });

  test("does not steal explicit sales comparisons", () => {
    expect(scoreVaultOperationalReviewIntent("Compare October 1-7 vs October 8-14 sales revenue in Khobar")).not.toBe(45);
  });
});
