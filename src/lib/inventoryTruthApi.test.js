import {
  clampInventoryTruthBranch,
  canViewInventoryTruthDiagnostics,
  inventoryIngredientBranchFilter,
  INVENTORY_TRUTH_SELECTS,
} from "./inventoryTruthApi";

describe("inventory truth access and query contracts", () => {
  test("clamps Fady / branch managers to their branch", () => {
    expect(clampInventoryTruthBranch({
      requestedBranch: "riyadh",
      access: { vaultRole: "branch_manager", branchIds: ["khobar"], primaryBranchId: "khobar" },
    })).toBe("khobar");
    expect(clampInventoryTruthBranch({
      requestedBranch: "riyadh",
      rbacProfile: { authenticated: true, allBranches: false, branchScope: "khobar" },
    })).toBe("khobar");
  });

  test("Super Admin may select any requested branch", () => {
    expect(clampInventoryTruthBranch({
      requestedBranch: "jeddah",
      access: { vaultRole: "super_admin", branchIds: ["khobar", "riyadh", "jeddah"] },
    })).toBe("jeddah");
    expect(canViewInventoryTruthDiagnostics({
      rbacProfile: { role: "developer", allBranches: true },
    })).toBe(true);
    expect(canViewInventoryTruthDiagnostics({
      access: { vaultRole: "branch_manager" },
    })).toBe(false);
  });

  test("sales and foundation selects are explicit and never star", () => {
    expect(INVENTORY_TRUTH_SELECTS.SALES_SELECT).not.toContain("*");
    expect(INVENTORY_TRUTH_SELECTS.SALES_SELECT).toContain("quantity_sold");
    expect(INVENTORY_TRUTH_SELECTS.COMMERCE_ITEM_SELECT).toContain("canonical_menu_item_id");
    expect(INVENTORY_TRUTH_SELECTS.COMMERCE_ITEM_SELECT).toContain("quantity");
    expect(INVENTORY_TRUTH_SELECTS.LINE_SELECT).toContain("sub_recipe_id");
    expect(INVENTORY_TRUTH_SELECTS.COST_STATE_SELECT).toContain("last_purchase_at");
    expect(Object.values(INVENTORY_TRUTH_SELECTS).every((value) => !value.includes("*"))).toBe(true);
  });

  test("network ingredients stay visible under a branch clamp", () => {
    expect(inventoryIngredientBranchFilter("khobar")).toEqual({
      mode: "branch_plus_network",
      or: "branch_id.is.null,branch_id.eq.khobar",
    });
    expect(inventoryIngredientBranchFilter(null)).toEqual({ mode: "network", or: null });
  });
});
