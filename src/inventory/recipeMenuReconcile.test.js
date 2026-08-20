import { RECONCILE_STATES, reconcileRecipesToLiveMenu } from "./recipeMenuReconcile";

const liveItems = [
  { id: "1", name: "Big Nac", name_en: "Big Nac", active: true, placement_group_id: "g-big" },
  { id: "2", name: "Watermelon & Cucumber", name_en: "Watermelon & Cucumber", active: true },
  { id: "3", name: "Prawn Rendang", name_en: "Prawn Rendang", active: true },
];

describe("recipeMenuReconcile", () => {
  test("live menu + recipe becomes active matched; punctuation/case still match", () => {
    const report = reconcileRecipesToLiveMenu({
      liveItems,
      recipes: [
        { recipeKind: "finished", ksaOperationalTitle: "BIG NAC", sourceFile: "Big NAC V2.pdf" },
        { recipeKind: "finished", ksaOperationalTitle: "Watermelon & Cucumber", sourceFile: "watermelon.pdf" },
      ],
    });
    expect(report.liveRows.find((row) => row.liveName === "Big Nac").state).toBe(RECONCILE_STATES.ACTIVE_MATCHED);
    expect(report.liveRows.find((row) => row.liveName === "Watermelon & Cucumber").state).toBe(RECONCILE_STATES.ACTIVE_MATCHED);
  });

  test("recipe absent from live menu is legacy/inactive and not operationally active", () => {
    const report = reconcileRecipesToLiveMenu({
      liveItems,
      recipes: [{ recipeKind: "finished", ksaOperationalTitle: "Apple Bircher Muesli", sourceFile: "Apple Bircher.pdf" }],
    });
    const bircher = report.recipeRows.find((row) => /apple bircher/i.test(row.recipeTitle));
    expect(bircher.state).toBe(RECONCILE_STATES.RECIPE_LEGACY_INACTIVE);
    expect(bircher.operationallyActive).toBe(false);
    expect(report.appleBircher.operationallyActive).toBe(false);
    expect(report.appleBircher.state).toBe(RECONCILE_STATES.RECIPE_LEGACY_INACTIVE);
  });

  test("ambiguous candidates do not silently resolve to active matched", () => {
    const report = reconcileRecipesToLiveMenu({
      liveItems: [
        { id: "a", name: "Tomato Salad", name_en: "Tomato Salad", active: true },
        { id: "b", name: "Green Salad", name_en: "Green Salad", active: true },
      ],
      recipes: [{ recipeKind: "finished", ksaOperationalTitle: "Tomato Green Salad Platter", sourceFile: "x.pdf" }],
    });
    const row = report.recipeRows[0];
    expect(row.state).not.toBe(RECONCILE_STATES.ACTIVE_MATCHED);
    expect(row.state).toBe(RECONCILE_STATES.AMBIGUOUS_MATCH);
  });

  test("prep cards are sub-recipe/non-sellable", () => {
    const report = reconcileRecipesToLiveMenu({
      liveItems,
      recipes: [{ recipeKind: "prep", ksaOperationalTitle: "Tomato sauce batch", sourceFile: "sauce.pdf" }],
    });
    expect(report.recipeRows[0].state).toBe(RECONCILE_STATES.SUB_RECIPE_NON_SELLABLE);
    expect(report.recipeRows[0].operationallyActive).toBe(false);
  });

  test("same live name in multiple placements is matched, not a silent conflict", () => {
    const report = reconcileRecipesToLiveMenu({
      liveItems: [
        { id: "a", name: "Halloumi", name_en: "Halloumi", active: true },
        { id: "b", name: "Halloumi", name_en: "Halloumi", active: true },
      ],
      recipes: [{ recipeKind: "finished", ksaOperationalTitle: "HALLOUMI", sourceFile: "Halloumi.pdf" }],
    });
    expect(report.recipeRows[0].state).toBe(RECONCILE_STATES.ACTIVE_MATCHED);
    expect(report.summary.activeMatched).toBe(2);
  });

  test("documented short-title aliases resolve when evidence is unique", () => {
    const report = reconcileRecipesToLiveMenu({
      liveItems: [
        ...liveItems,
        { id: "4", name: "Shakshuka", name_en: "Shakshuka", active: true },
        { id: "5", name: "Brownie, Caramel, Vanilla Ice Cream", name_en: "Brownie, Caramel, Vanilla Ice Cream", active: true },
        { id: "6", name: "Mushroom Toast", name_en: "Mushroom Toast", active: true },
      ],
      recipes: [
        { recipeKind: "finished", ksaOperationalTitle: "SHAKSHUKA POACHED EGGS FETA ZA ATAR PITA", sourceFile: "shak.pdf" },
        { recipeKind: "finished", ksaOperationalTitle: "Chocolate brownie with Cookie chunk caramel", sourceFile: "brownie.pdf" },
        { recipeKind: "finished", ksaOperationalTitle: "Mushroom TOAT hazelnut salt", sourceFile: "toast.pdf" },
      ],
    });
    expect(report.liveRows.find((row) => row.liveName === "Shakshuka").state).toBe(RECONCILE_STATES.ACTIVE_MATCHED);
    expect(report.liveRows.find((row) => /brownie/i.test(row.liveName)).state).toBe(RECONCILE_STATES.ACTIVE_MATCHED);
    expect(report.liveRows.find((row) => row.liveName === "Mushroom Toast").state).toBe(RECONCILE_STATES.ACTIVE_MATCHED);
  });
});
