import {
  buildFoodBibleCohortPreview,
  extractFoodBibleRecipesFromPages,
  normalizeCanonicalUnit,
  splitFoodBiblePages,
  validateFoodBibleRecipeTitle,
} from "./foodBiblePdfExtract";

const RIGATONI_PAGES = [
  {
    page: 1,
    text: `Utensils Used Allergens:
Menu Section
Prep Time
Cooking Time
Yield
5 minutes
1 Pax
RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO
Sauce pan / spatula Alcohol / Gluten / Dairy /
Celery Mains
15 minutes`,
  },
  {
    page: 2,
    text: `Unit 1 Batch Notes
g 200 Pre cooked 5 minutes
g 400 300gr - when reduced
g 2
g 10
g 1
g 22 Grated
g 2
1. In a sauce pan, add the tomato sauce and bring to a boil.
To Serve
Critical Control
Ingredients
Rigatonni pasta (De Ceddo)
Vodka tomato sauce
Basil leaves
Extra virgin olive oil
Chilli flakes
Parmigianno
Table salt
Method`,
  },
  {
    page: 3,
    text: `Utensils Used Allergens: Celery / Alcohol / Dairy
Menu Section
Prep Time
Cooking Time
Yield
Ingredients Unit 1 Batch Notes
g 12500
Red onion g 5000 dice 3x3 cm
Carrots g 1000 dice 3x3 cm
Celery stick g 500 dice 3x3 cm
Garlic g 150 cut in 1/2
Basil stem trimming g 50
Salt g 100
Olive oil g 300
g 2300
1. Heat up a large sauce pan then add some olive oil.
Double cream
Method
VODKA TOMATO SAUCE
Sauce pan / spatula / green chopping board / chef
knife / strainer
Base
30 minutes
3 hours
16.5 KG
Tinned tomatoes`,
  },
  {
    page: 4,
    text: `2. Once the vegetables had colored a bit, deglaze it with the vodka and let ir reduce fully.
3. Add in the tinned tomatoes and mix well.
Critical Control`,
  },
];

describe("Food Bible PDF extract", () => {
  test("normalizes safe mass and volume units", () => {
    expect(normalizeCanonicalUnit("g", 2000)).toEqual({
      canonicalQuantity: 2,
      canonicalUnit: "kg",
      unitConversion: "SAFE_G_TO_KG",
    });
    expect(normalizeCanonicalUnit("ml", 4000)).toEqual({
      canonicalQuantity: 4,
      canonicalUnit: "litre",
      unitConversion: "SAFE_ML_TO_L",
    });
  });

  test("rejects placeholder and quantity-only false titles", () => {
    expect(validateFoodBibleRecipeTitle("N/A").ok).toBe(false);
    expect(validateFoodBibleRecipeTitle("50 UNITS").ok).toBe(false);
    expect(validateFoodBibleRecipeTitle("10.94 KG").ok).toBe(false);
    expect(validateFoodBibleRecipeTitle("RIGATONI, PINK SAUCE, BASIL, CHILI, PARMIGIANO", {
      pageTexts: ["Ingredients\nMethod\nYield\n1 Pax"],
      method: ["1. Cook"],
      yieldRaw: "1 Pax",
      ingredients: [{ sourceName: "Pasta" }],
    }).ok).toBe(true);
  });

  test("extracts Rigatoni finished dish with sequential qty/name pairing", () => {
    const { recipes } = extractFoodBibleRecipesFromPages({
      sourceFile: "Rigatoni, pink sauce, basil, chili, parmigiano.pdf",
      pages: RIGATONI_PAGES,
    });
    const finished = recipes.find((r) => r.sourceTitle.includes("RIGATONI"));
    expect(finished).toBeTruthy();
    expect(finished.yieldRaw).toMatch(/1\s*Pax/i);
    expect(finished.ksaIngredients.map((i) => i.ksaOperationalName)).toEqual([
      "Rigatonni pasta (De Ceddo)",
      "Tomato Sauce",
      "Basil leaves",
      "Extra virgin olive oil",
      "Chilli flakes",
      "Parmigianno",
      "Table salt",
    ]);
    expect(finished.ksaIngredients[0].sourceQuantity).toBe(200);
    expect(finished.ksaIngredients[1].sourceQuantity).toBe(400);
    expect(finished.adaptations.some((a) => a.rule === "VODKA_TOMATO_SAUCE_RENAME")).toBe(true);
  });

  test("extracts Vodka Tomato Sauce as KSA Tomato Sauce with reverse orphan pairing", () => {
    const { recipes } = extractFoodBibleRecipesFromPages({
      sourceFile: "Rigatoni, pink sauce, basil, chili, parmigiano.pdf",
      pages: RIGATONI_PAGES,
    });
    const sauce = recipes.find((r) => r.sourceTitle === "VODKA TOMATO SAUCE");
    expect(sauce).toBeTruthy();
    expect(sauce.ksaOperationalTitle).toBe("TOMATO SAUCE");
    expect(sauce.ksaOperationalTitle).not.toMatch(/vodka/i);
    expect(sauce.yieldRaw).toMatch(/16\.5\s*KG/i);

    const byName = Object.fromEntries(
      sauce.ksaIngredients.map((i) => [i.ksaOperationalName, i])
    );
    expect(byName["Tinned tomatoes"].sourceQuantity).toBe(12500);
    expect(byName["Double cream"].sourceQuantity).toBe(2300);
    expect(byName["Red onion"].sourceQuantity).toBe(5000);
    expect(sauce.issues.some((i) => /vodka/i.test(i.detail || ""))).toBe(true);
    expect(sauce.previewTrustStatus).toBe("NEEDS_REVIEW");
  });

  test("preserves international source title separately from KSA operational title", () => {
    const { recipes } = extractFoodBibleRecipesFromPages({
      sourceFile: "Rigatoni, pink sauce, basil, chili, parmigiano.pdf",
      pages: RIGATONI_PAGES,
    });
    const sauce = recipes.find((r) => r.sourceTitle === "VODKA TOMATO SAUCE");
    expect(sauce.sourceMarket).toBe("international");
    expect(sauce.operationalMarket).toBe("KSA");
    expect(sauce.sourceTitle).toBe("VODKA TOMATO SAUCE");
    expect(sauce.ksaOperationalTitle).toBe("TOMATO SAUCE");
  });

  test("builds cohort preview without production mutation and with menu link statuses", () => {
    const preview = buildFoodBibleCohortPreview({
      files: [
        {
          sourceFile: "Rigatoni, pink sauce, basil, chili, parmigiano.pdf",
          pages: RIGATONI_PAGES,
        },
      ],
      menuItems: [{ id: "m1", name: "Rigatoni", price: 72 }],
    });
    expect(preview.productionMutation).toBe(false);
    expect(preview.summary.productionApply).toBe("BLOCKED_UNTIL_REVIEW");
    expect(preview.summary.salesApproval).toBe("NOT_IN_SCOPE");
    expect(preview.summary.vodkaTitleRenames).toBe(1);
    const rigatoniLink = preview.menuLinks.find((l) =>
      /rigatoni/i.test(l.ksaOperationalTitle)
    );
    expect(rigatoniLink?.linkStatus).toBe("CANDIDATE");
  });

  test("splitFoodBiblePages reads page markers", () => {
    const pages = splitFoodBiblePages("===== PAGE 1 =====\nHello\n===== PAGE 2 =====\nWorld");
    expect(pages).toEqual([
      { page: 1, text: "\nHello\n" },
      { page: 2, text: "\nWorld" },
    ]);
  });

  test("keeps dish-named ingredients like Halloumi and pairs sequential quantities", () => {
    const { recipes } = extractFoodBibleRecipesFromPages({
      sourceFile: "Halloumi.pdf",
      pages: [
        {
          page: 1,
          text: `Utensils Used Allergens: Dairy / sesame
Menu Section
Prep Time
Cooking Time
Yield
HALLOUMI`,
        },
        {
          page: 2,
          text: `Unit 1 Batch Notes
g 95 3 slices of 1cm
g 2
ml 15
1. Place the halloumi on the griddle
To Serve
Critical Control
Ingredients
Halloumi
Za'atar
Olive oil
Method`,
        },
      ],
    });
    const halloumi = recipes.find((r) => r.sourceTitle === "HALLOUMI");
    expect(halloumi).toBeTruthy();
    expect(halloumi.ksaIngredients.map((i) => i.ksaOperationalName)).toEqual([
      "Halloumi",
      "Za'atar",
      "Olive oil",
    ]);
    expect(halloumi.ksaIngredients[0].sourceQuantity).toBe(95);
    expect(halloumi.ksaIngredients[2].sourceQuantity).toBe(15);
  });

  test("keeps inline ingredient rows when notes contain verbs like remove", () => {
    const { recipes } = extractFoodBibleRecipesFromPages({
      sourceFile: "cajun.pdf",
      pages: [
        {
          page: 1,
          text: `Utensils Used
Menu Section
Prep Time
Cooking Time
Yield
CAJUN CHICKEN FILLET
8 pax
Ingredients Unit 1 Batch Notes
Chicken fillets (8 fillets) g 2000 Remove nerve & fat
Cajun spices g 50
ml 200
1. Season the chicken.
Method
Cooking oil`,
        },
      ],
    });
    const fillet = recipes.find((r) => r.sourceTitle === "CAJUN CHICKEN FILLET");
    expect(fillet).toBeTruthy();
    const chicken = fillet.ksaIngredients.find((i) => /chicken fillets/i.test(i.ksaOperationalName));
    expect(chicken?.sourceQuantity).toBe(2000);
    expect(chicken?.unitConversion || chicken?.canonicalUnit).toBeTruthy();
  });

  test("accepts title-case dish names such as Prawn Rendang", () => {
    const { recipes, rejectedTitles } = extractFoodBibleRecipesFromPages({
      sourceFile: "Prawn Rendang, grilled lemon .pdf",
      pages: [
        { page: 1, text: `Prawn Rendang, grilled lemon\nUtensils Used\nAllergens:\nMenu Section\nMAINS\nPrep Time` },
        { page: 2, text: `Ingredients\nUnit\n1 Batch\nNotes\nGinger root\ng\n26\nPrawns Tiger 16/29\npcs\n6\n1. Stir in the rendang paste.\nMethod` },
      ],
    });
    expect(rejectedTitles).toHaveLength(0);
    expect(recipes.some((recipe) => /prawn rendang/i.test(recipe.sourceTitle))).toBe(true);
  });
});
