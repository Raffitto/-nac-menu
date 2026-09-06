import { buildIdentityClusters, CLUSTER_KIND } from "./identityClusters";

describe("menu identity clusters", () => {
  test("same name same branch same price is an exact duplicate defect", () => {
    const result = buildIdentityClusters([
      { id: "a", name_en: "2 Eggs Any Style", active: true, branch_id: "khobar", price: 28 },
      { id: "b", name_en: "2 Eggs Any Style", active: true, branch_id: "khobar", price: 28 },
    ]);
    expect(result.duplicateClusterCount).toBe(1);
    expect(result.rowsInsideDuplicateClusters).toBe(2);
    expect(result.clusters[0].kind).toBe(CLUSTER_KIND.EXACT_DUPLICATE_DEFECT);
  });

  test("same name on two branches is a legitimate branch copy", () => {
    const result = buildIdentityClusters([
      { id: "a", name_en: "Shakshuka", active: true, branch_id: "khobar", price: 42 },
      { id: "b", name_en: "Shakshuka", active: true, branch_id: "riyadh", price: 42 },
    ]);
    expect(result.clusters[0].kind).toBe(CLUSTER_KIND.BRANCH_COPY);
    expect(result.exactDefectCount).toBe(0);
    expect(result.sameBranchPlacementCount).toBe(0);
  });

  test("shared placement group is the same live item, not a merge candidate", () => {
    const result = buildIdentityClusters([
      { id: "a", name_en: "Big NAC", active: true, placement_group_id: "pg1", price: 55 },
      { id: "b", name_en: "Big NAC", active: true, placement_group_id: "pg1", price: 55 },
    ]);
    expect(result.clusters[0].kind).toBe(CLUSTER_KIND.SAME_LIVE_ITEM);
  });
});
