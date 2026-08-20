import { parseFoodBibleCard, parseFoodBiblePdfExtract } from "./foodBibleSourceCardParser";

const quinoaPages = [
  {
    page: 1,
    text: "Utensils Used\n \nAllergens:\n \nN/A\n\nMenu Section\nPrep Time\nCooking Time\nYield\n \n1 Pax\n\nQUINOA, POMEGRANATE, BABY TOMATO, LEMON CONFIT DRESSING\n\nMixing bowl / spatula\nSalads\n5 minutes\nN/A",
  },
  {
    page: 2,
    text: "Unit\n \n1 Batch\n \nNotes\n\ng\n \n130\ng\n \n10\ng\n \n30\ng\n \n20\n \nSliced in mandoline\ng\n \n5\n \nLeaves\ng\n \n5\n \nLeaves\ng\n \n20\ng\n \n2\n1. In a bowl, add the quinoa and season it with the lemon confit dressing.\n1. Add the seasoned quinoa at the bottom of the serving bowl and top it up with all the remaining ingredients.\nTo Serve\nCritical Control\n\nQuinoa\nLemon confit dressing\nConfit baby tomatoes\nRadish\nParsley\nCoriander\nPomegranate seeds\n\nIngredients\n\nMaldon salt (smoked)\n\nMethod",
  },
];

const quinoaCooking = [
  {
    page: 7,
    text: "Utensils Used\nAllergens:\nN/A\nMenu Section\nPrep Time\nCooking Time\nYield\nUnit\n1 Batch\nNotes\ng\n4000\ng\n5000\n1. Prepare the rice cooker with the cooking mat.\nIngredients\nQUINOA COOKING\nRice cooker\nBase\n2 minutes\n45 minutes\nWhite quinoa\nWater\nMethod\nCritical Control",
  },
];

const bigNacCover = [
  {
    page: 1,
    text: "BIG NAC\nUtensils Used\nPlancha / spatula / meat presser\nAllergens:\nGluten / Dairy / Eggs\nMenu Section\nMains\nPrep Time\n5 minutes\nCooking Time\n10 minutes\nYield\n1 Pax\nIngredients\nUnit\n1 Batch\nNotes\nMinced beef\ng\n160\n2x 80g\nBurger bun (sesame)\npc\n1\n3 layers\nButter unsalted\ng\n10\nMethod\n1. take one portion of beef patty and season it with a bit of salt.",
  },
];

describe("foodBibleSourceCardParser", () => {
  test("recovers quinoa ingredient quantities that the column-split PDF extract lost", () => {
    const card = parseFoodBibleCard(quinoaPages);
    expect(card.title).toMatch(/QUINOA/i);
    expect(card.method[0]).toMatch(/lemon confit dressing/i);
    const quinoa = card.ingredients.find((row) => /quinoa/i.test(row.sourceName) && !/dressing/i.test(row.sourceName));
    const dressing = card.ingredients.find((row) => /lemon confit dressing/i.test(row.sourceName));
    const tomatoes = card.ingredients.find((row) => /confit baby tomatoes/i.test(row.sourceName));
    expect(quinoa).toMatchObject({ sourceQuantity: 130, sourceUnit: "gram" });
    expect(dressing).toMatchObject({ sourceQuantity: 10, sourceUnit: "gram" });
    expect(tomatoes).toMatchObject({ sourceQuantity: 30, sourceUnit: "gram" });
    expect(card.ingredients.length).toBeGreaterThanOrEqual(7);
  });

  test("does not invent quantities when names and amounts cannot be aligned", () => {
    const card = parseFoodBibleCard([{ page: 1, text: "Ingredients\nMystery garnish\nMethod\n1. Plate." }]);
    expect(card.ingredients.every((row) => row.sourceQuantity != null)).toBe(true);
    expect(card.ingredients).toHaveLength(0);
  });

  test("parses interleaved Big NAC lines and quinoa cooking batch", () => {
    const burger = parseFoodBibleCard(bigNacCover);
    expect(burger.ingredients.find((row) => /minced beef/i.test(row.sourceName))).toMatchObject({
      sourceQuantity: 160,
      sourceUnit: "gram",
    });
    const cooking = parseFoodBibleCard(quinoaCooking);
    expect(cooking.title).toMatch(/QUINOA COOKING/i);
    expect(cooking.ingredients.find((row) => /white quinoa/i.test(row.sourceName))).toMatchObject({
      sourceQuantity: 4000,
      sourceUnit: "gram",
    });
  });

  test("splits a multi-card PDF extract into separate recipes", () => {
    const cards = parseFoodBiblePdfExtract({ pages: [...quinoaPages, ...quinoaCooking] });
    expect(cards.some((card) => /POMEGRANATE/i.test(card.title))).toBe(true);
    expect(cards.some((card) => /QUINOA COOKING/i.test(card.title))).toBe(true);
  });
});
