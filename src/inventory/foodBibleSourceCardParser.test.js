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
    expect(card.ingredients.find((row) => /radish/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 20, sourceUnit: "gram" });
    expect(card.ingredients.find((row) => /parsley/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 5, sourceUnit: "gram" });
    expect(card.ingredients.find((row) => /coriander/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 5, sourceUnit: "gram" });
    expect(card.ingredients.find((row) => /pomegranate/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 20, sourceUnit: "gram" });
    expect(card.ingredients.find((row) => /maldon/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 2, sourceUnit: "gram" });
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

  test("maps Black Angus cover metadata without stuffing the title into prep/cook", () => {
    const card = parseFoodBibleCard([
      {
        page: 1,
        text: "Utensils Used\nAllergens:\nMenu Section\nPrep Time\nCooking Time\nYield\nBLACK ANGUS, BLACK PEPPERCORN\nGriddle/ knife/ Cutting board\nDairy/ Gluten /\nSulphites\nMains\n8 to 12 min\n1 pax",
      },
      {
        page: 2,
        text: "Unit\n1 Batch\nNote\ng\n75\ng\n150\nOil cooking\nml\n10\nTable salt\ng\n3\nBlack pepper\ng\n10\n1. Warm peppercorn sauce in a saucepan, keep warm for service\n1. Take the sirloin out of the fridge and leave at the room temperature for 5 min. Season each side with table salt\nCook on the plancha to asked temperature and let rest on a tray for 3 min\n2. Slice the steak in 3mm slices and place in the middle of the plate. Add the hot peppercorn sauce\nand top up with chopped chives and few micro herbs\nTo Serve\nCritical Control\nIngredients\nPeppercorn sauce\nBlack Angus steak\nMethod",
      },
    ]);
    expect(card.title).toBe("BLACK ANGUS, BLACK PEPPERCORN");
    expect(card.menuSection).toBe("Mains");
    expect(card.prepTime).toBe("");
    expect(card.cookTime).toMatch(/8 to 12 min/i);
    expect(card.allergens).toMatch(/Dairy/i);
    expect(card.allergens).toMatch(/Sulphites/i);
    expect(card.utensils).toMatch(/Griddle/i);
    expect(card.yieldQuantity).toBe(1);
    expect(card.ingredients.find((row) => /peppercorn sauce/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 75, sourceUnit: "gram" });
    expect(card.ingredients.find((row) => /black angus steak/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 150, sourceUnit: "gram" });
    expect(card.ingredients.find((row) => /oil cooking/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 10, sourceUnit: "millilitre" });
    expect(card.ingredients.find((row) => /table salt/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 3, sourceUnit: "gram" });
    expect(card.ingredients.find((row) => /black pepper/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 10, sourceUnit: "gram" });
  });

  test("keeps Peppercorn Sauce explicit 300 g yield and Butter, leaving Demi glace unresolved", () => {
    const card = parseFoodBibleCard([{
      page: 3,
      text: "Utensils Used\nAllergens:\nMenu Section\nPrep Time\nCooking Time\nYield\nIngredients\nUnit\n1 Batch\nNotes\nDouble cream\nml\n4000\nShallots\ng\n330\nBlack peppercorn\ng\n20\ng\n50\ng\npowder\n1.In the pan add black peppercorn and cook for a further 3 min\nButter\nDemi glace\nMethod\nPEPPERCORN SAUCE\nSaucepan/ Whisk\nDairy/ Gluten / Sulphites\nMain Bases\n30 minutes\n300 G",
    }]);
    expect(card.title).toBe("PEPPERCORN SAUCE");
    expect(card.yieldQuantity).toBe(300);
    expect(card.yieldUnit).toBe("gram");
    expect(card.cookTime).toMatch(/30 minutes/i);
    expect(card.prepTime).toBe("");
    expect(card.menuSection).toMatch(/Main Bases/i);
    expect(card.ingredients.find((row) => /double cream/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 4000, sourceUnit: "millilitre" });
    expect(card.ingredients.find((row) => /^butter$/i.test(row.sourceName))).toMatchObject({ sourceQuantity: 50, sourceUnit: "gram" });
    expect(card.unresolvedIngredients.some((row) => /demi glace/i.test(row.sourceName))).toBe(true);
  });
});
