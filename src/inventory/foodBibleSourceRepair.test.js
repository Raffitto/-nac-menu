import { parseFoodBibleCard } from "./foodBibleSourceCardParser";
import { classifyRepairEligibility, isEquipmentName, isCulinaryIngredientName, resolveSourceLine } from "./foodBibleSourceRepair";

const quinoaPages = [
  {
    page: 1,
    text: "Utensils Used\nAllergens:\nN/A\nMenu Section\nPrep Time\nCooking Time\nYield\n1 Pax\nQUINOA, POMEGRANATE, BABY TOMATO, LEMON CONFIT DRESSING\nMixing bowl / spatula\nSalads\n5 minutes\nN/A",
  },
  {
    page: 2,
    text: "Unit\n1 Batch\nNotes\ng\n130\ng\n10\ng\n30\ng\n20\nSliced in mandoline\ng\n5\nLeaves\ng\n5\nLeaves\ng\n20\ng\n2\n1. Season quinoa.\nTo Serve\nQuinoa\nLemon confit dressing\nConfit baby tomatoes\nRadish\nParsley\nCoriander\nPomegranate seeds\nIngredients\nMaldon salt (smoked)\nMethod",
  },
];

describe("foodBibleSourceRepair", () => {
  const recipes = [
    { id: "r-q", name: "QUINOA, POMEGRANATE, BABY TOMATO, LEMON CONFIT DRESSING", recipeType: "menu_item" },
    { id: "r-cook", name: "QUINOA COOKING", recipeType: "preparation" },
    { id: "r-dress", name: "LEMON CONFIT DRESSING", recipeType: "preparation" },
    { id: "r-tom", name: "CONFIT CHERRY TOMATOES", recipeType: "preparation" },
    { id: "r-big", name: "BIG NAC", recipeType: "menu_item" },
  ];
  const ingredients = [
    { id: "i-parsley", canonicalName: "Parsley" },
    { id: "i-coriander", canonicalName: "Coriander" },
    { id: "i-salt", canonicalName: "Maldon salt (smoked)" },
  ];

  test("maps quinoa dish lines to components and will create missing culinary ingredients", () => {
    const card = parseFoodBibleCard(quinoaPages);
    const siblings = ["quinoa cooking", "lemon confit dressing", "confit cherry tomatoes"];
    const resolved = card.ingredients.map((row) => ({
      ...row,
      resolution: resolveSourceLine({
        sourceName: row.sourceName,
        recipes,
        ingredients,
        selfRecipeId: "r-q",
        siblingComponentKeys: siblings,
      }),
    }));
    expect(resolved.find((row) => row.sourceName === "Quinoa").resolution).toMatchObject({ kind: "component", recipe: { id: "r-cook" } });
    expect(resolved.find((row) => /lemon confit dressing/i.test(row.sourceName)).resolution.kind).toBe("component");
    expect(resolved.find((row) => /confit baby tomatoes/i.test(row.sourceName)).resolution).toMatchObject({
      kind: "component",
      recipe: { id: "r-tom" },
    });
    expect(resolved.find((row) => /radish/i.test(row.sourceName)).resolution.kind).toBe("create_ingredient");
    expect(resolved.find((row) => /pomegranate/i.test(row.sourceName)).resolution.kind).toBe("create_ingredient");
    expect(resolved.find((row) => /parsley/i.test(row.sourceName)).resolution.kind).toBe("ingredient");
  });

  test("does not guess a component alias without same-PDF provenance", () => {
    const resolution = resolveSourceLine({
      sourceName: "Quinoa",
      recipes: [{ id: "r-cook", name: "QUINOA COOKING", recipeType: "preparation" }],
      ingredients: [],
      selfRecipeId: "r-q",
      siblingComponentKeys: [],
    });
    expect(resolution).toMatchObject({ kind: "unresolved", reason: "component_identity_uncertain" });
  });

  test("does not overwrite structured recipes or empty source cards", () => {
    expect(classifyRepairEligibility({
      recipe: recipes[4],
      existingLineCount: 8,
      qtyRows: [{ sourceName: "Beef", sourceQuantity: 160 }],
    }).eligible).toBe(false);
    expect(classifyRepairEligibility({
      recipe: recipes[0],
      existingLineCount: 0,
      qtyRows: [],
    }).eligible).toBe(false);
    expect(classifyRepairEligibility({
      recipe: recipes[0],
      existingLineCount: 0,
      qtyRows: parseFoodBibleCard(quinoaPages).ingredients,
    }).eligible).toBe(true);
  });

  test("does not treat panko or pancakes as equipment", () => {
    expect(isEquipmentName("Panko breadcrumbs")).toBe(false);
    expect(isCulinaryIngredientName("Panko breadcrumbs")).toBe(true);
    expect(isEquipmentName("Pancakes")).toBe(false);
    expect(isEquipmentName("Mixing bowl")).toBe(true);
    expect(isEquipmentName("Rice cooker")).toBe(true);
  });
});
