import { classifyKitchenRecipeGaps, RECIPE_GAP_CLASS } from "./recipeMappingClassification";

describe("kitchen recipe mapping classification", () => {
  test("splits exact, ambiguous, legacy, true missing, and false positive", () => {
    const result = classifyKitchenRecipeGaps({
      menuItems: [
        { id: "m1", name_en: "Shakshuka", active: true },
        { id: "m2", name_en: "2 Eggs Any Style", active: true },
        { id: "m3", name_en: "2 Eggs Any Style", active: true },
        { id: "m4", name_en: "Legacy Hash", active: true },
        { id: "m5", name_en: "Mystery Plate", active: true },
        { id: "m6", name_en: "Pepsi", category_name: "Soft drinks", active: true },
      ],
      recipes: [
        { id: "r1", name: "Shakshuka", normalized_name: "shakshuka", active: true },
        { id: "r2", name: "2 Eggs Any Style", active: true },
        { id: "r3", name: "2 Eggs Any Style", active: true },
        { id: "r4", name: "Legacy Hash", active: false },
      ],
    });
    expect(result.counts[RECIPE_GAP_CLASS.EXACT_MAPPING_MISSING]).toBe(1);
    expect(result.counts[RECIPE_GAP_CLASS.AMBIGUOUS]).toBe(2);
    expect(result.counts[RECIPE_GAP_CLASS.LEGACY_ONLY]).toBe(1);
    expect(result.counts[RECIPE_GAP_CLASS.TRUE_MISSING]).toBe(1);
    expect(result.counts[RECIPE_GAP_CLASS.FALSE_POSITIVE]).toBe(1);
    expect(result.repaired).toBe(0);
    expect(result.deterministicRepairable).toBe(1);
  });
});
