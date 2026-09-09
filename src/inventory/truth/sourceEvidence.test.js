import liveCatalog from "./sourceEvidence.catalog.json";
import { SOURCE_EVIDENCE_CLASS } from "./readinessContracts";
import {
  applySourceEvidenceToRecipeRow,
  classifyFoodicsProductIdentity,
  compareDraftToSource,
  sourceHasIngredient,
} from "./sourceEvidence";
import { ACTIVATION_DECISION } from "./readinessContracts";

const catalog = {
  dishes: [
    {
      dish: "BLACK ANGUS, BLACK PEPPERCORN",
      pdf: "Black Angus, black peppercorn.pdf",
      foodicsName: "Black Angus Steak au Poivre",
      lines: [
        { name: "Peppercorn sauce", qty: "75", unit: "gram" },
        { name: "Black Angus steak", qty: "150", unit: "gram" },
        { name: "Oil cooking", qty: "10", unit: "millilitre" },
        { name: "Table salt", qty: "3", unit: "gram" },
        { name: "Black pepper", qty: "10", unit: "gram" },
      ],
    },
    {
      dish: "SPECULOOS FRENCH TOAST, RASPBERRIES, CLOTTED CREAM",
      pdf: "Speculoos french toast, raspberries, clotted cream.pdf",
      foodicsName: "French Toast",
      lines: [
        { name: "French toast batter bun", qty: "80", unit: "gram" },
        { name: "Clotted cream", qty: "50", unit: "gram" },
        { name: "Raspberries", qty: "40", unit: "gram" },
        { name: "Speculos", qty: "10", unit: "gram" },
        { name: "Honey", qty: "20", unit: "gram" },
        { name: "Butter", qty: "20", unit: "gram" },
      ],
    },
    {
      dish: "HOUSE SALAD WITH HAZELNUT SALT",
      pdf: "House salad with hazelnut salt (batches).pdf",
      foodicsName: "House Salad",
      lines: [
        { name: "Baby gem lettuce", qty: "1", unit: "each" },
        { name: "House salad dressing", qty: "20", unit: "gram" },
        { name: "Hazelnut", qty: "20", unit: "gram" },
        { name: "Red radish", qty: "25", unit: "gram" },
        { name: "Chives", qty: "1", unit: "gram" },
        { name: "Maldon salt (smoked)", qty: "2", unit: "gram" },
      ],
    },
    {
      dish: "HONEY SWEET POTATO, BLACK PEPPER YOGURT, ZHOUGH",
      pdf: "Honey sweet potato, black pepper yogurt, zhoug.pdf",
      foodicsName: "Sweet Potato",
      lines: [
        { name: "Sweet potatoes", qty: "170", unit: "gram" },
        { name: "Honey", qty: "20", unit: "gram" },
        { name: "Smoked maldon salt", qty: "2", unit: "gram" },
      ],
    },
    {
      dish: "FRITES",
      pdf: "Frites.pdf",
      foodicsName: "Fries",
      lines: [
        { name: "Fries", qty: "200", unit: "gram" },
        { name: "Table salt", qty: "3", unit: "gram" },
      ],
    },
    {
      dish: "HALLOUMI FRIES, HONEY SRIRACHA",
      pdf: "Halloumi fries.pdf",
      foodicsName: "Halloumi fries",
      lines: [
        { name: "Halloumi", qty: "160", unit: "gram" },
        { name: "Honey sriracha", qty: "32", unit: "gram" },
      ],
    },
    {
      dish: "2 EGGS ANY STYLE - FRIED",
      pdf: "2 eggs any style - fried.pdf",
      foodicsName: null,
      lines: [{ name: "Butter", qty: "10", unit: "gram" }],
    },
    {
      dish: "2 EGGS ANY STYLE - POACHED",
      pdf: "2 eggs any style - poached.pdf",
      foodicsName: null,
      lines: [{ name: "Egg", qty: "2", unit: "each" }],
    },
  ],
  foodicsProducts: [
    { sku: "sk-1184", name: "7up" },
    { sku: "sk-0681", name: "Passionfruit Mojito" },
    { sku: "sk-1431", name: "Passionfruit Mojito" },
  ],
};

describe("source evidence classification", () => {
  test("exact brand lines are SOURCE_CONFIRMED_CURRENT and stay SAFE", () => {
    const evidence = compareDraftToSource({
      recipeName: "BLACK ANGUS, BLACK PEPPERCORN",
      soldDisplayName: "Black Angus Steak au Poivre",
      draftLines: [
        { name: "PEPPERCORN SAUCE", qty: "75", unit: "gram" },
        { name: "Black Angus steak", qty: "150", unit: "gram" },
        { name: "Oil cooking", qty: "10", unit: "millilitre" },
        { name: "table salt", qty: "3", unit: "gram" },
        { name: "Black pepper", qty: "10", unit: "gram" },
      ],
      catalog,
    });
    expect(evidence.class).toBe(SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_CURRENT);
    expect(sourceHasIngredient(evidence, /maldon/i)).toBe(false);
    expect(sourceHasIngredient(evidence, /table salt/i)).toBe(true);
    const row = applySourceEvidenceToRecipeRow({
      decision: ACTIVATION_DECISION.SAFE_TO_ACTIVATE,
      reason: "structurally valid",
    }, evidence);
    expect(row.decision).toBe(ACTIVATION_DECISION.SAFE_TO_ACTIVATE);
  });

  test("qty mismatch is SOURCE_CONFIRMED_WITH_DIFFERENCES and cannot stay SAFE", () => {
    const evidence = compareDraftToSource({
      recipeName: "HONEY SWEET POTATO, BLACK PEPPER YOGURT, ZHOUGH",
      draftLines: [
        { name: "Sweet potatoes", qty: "220", unit: "gram" },
        { name: "Honey", qty: "20", unit: "gram" },
        { name: "Smoked maldon salt", qty: "2", unit: "gram" },
      ],
      catalog,
    });
    expect(evidence.class).toBe(SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_WITH_DIFFERENCES);
    const row = applySourceEvidenceToRecipeRow({
      decision: ACTIVATION_DECISION.SAFE_TO_ACTIVATE,
      reason: "structurally valid",
    }, evidence);
    expect(row.decision).toBe(ACTIVATION_DECISION.REVIEW_REQUIRED);
  });

  test("French Toast strongest source includes Honey 20 g and ignores Total artifacts", () => {
    const evidence = compareDraftToSource({
      recipeName: "SPECULOOS FRENCH TOAST, RASPBERRIES, CLOTTED CREAM",
      draftLines: [
        { name: "French toast batter bun", qty: "80", unit: "gram" },
        { name: "CLOTTED CREAM", qty: "50", unit: "gram" },
        { name: "Raspberries", qty: "40", unit: "gram" },
        { name: "SPECULOS", qty: "10", unit: "gram" },
        { name: "honey", qty: "20", unit: "gram" },
        { name: "Butter", qty: "20", unit: "gram" },
        { name: "Total", qty: "220", unit: "gram" },
      ],
      catalog,
    });
    expect(evidence.class).toBe(SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_CURRENT);
    const honey = evidence.sourceDish.lines.find((line) => /honey/i.test(line.name));
    expect(honey).toEqual({ name: "Honey", qty: "20", unit: "gram" });
  });

  test("House Salad source dressing is a sub-recipe and has no Honey", () => {
    const evidence = compareDraftToSource({
      recipeName: "HOUSE SALAD WITH HAZELNUT SALT",
      draftLines: [
        { name: "Baby gem lettuce", qty: "1", unit: "each" },
        { name: "HOUSE SALAD DRESSING", qty: "20", unit: "gram" },
        { name: "Hazelnut", qty: "20", unit: "gram" },
        { name: "Red radish", qty: "25", unit: "gram" },
        { name: "Chives", qty: "1", unit: "gram" },
        { name: "Maldon salt (smoked)", qty: "2", unit: "gram" },
      ],
      catalog,
    });
    expect(evidence.class).toBe(SOURCE_EVIDENCE_CLASS.SOURCE_CONFIRMED_CURRENT);
    expect(sourceHasIngredient(evidence, /honey/i)).toBe(false);
    expect(sourceHasIngredient(evidence, /dressing/i)).toBe(true);
  });

  test("sold Fries against Halloumi Fries is IDENTITY_MAPPING_PROBLEM", () => {
    const evidence = compareDraftToSource({
      recipeName: "HALLOUMI FRIES, HONEY SRIRACHA",
      soldDisplayName: "Fries",
      draftLines: [
        { name: "Halloumi", qty: "160", unit: "gram" },
        { name: "Honey sriracha", qty: "32", unit: "gram" },
      ],
      catalog,
    });
    expect(evidence.class).toBe(SOURCE_EVIDENCE_CLASS.IDENTITY_MAPPING_PROBLEM);
  });

  test("ambiguous 2 Eggs any style sold name is IDENTITY_MAPPING_PROBLEM", () => {
    const evidence = compareDraftToSource({
      recipeName: "2 EGGS ANY STYLE - FRIED",
      soldDisplayName: "2 Eggs any style",
      draftLines: [{ name: "Butter", qty: "10", unit: "gram" }],
      catalog,
    });
    expect(evidence.class).toBe(SOURCE_EVIDENCE_CLASS.IDENTITY_MAPPING_PROBLEM);
  });

  test("prep recipe without a brand dish is NO_SOURCE_EVIDENCE", () => {
    const evidence = compareDraftToSource({
      recipeName: "HONEY SRIRACHA - BATCH",
      draftLines: [{ name: "Honey", qty: "250", unit: "gram" }],
      catalog,
    });
    expect(evidence.class).toBe(SOURCE_EVIDENCE_CLASS.NO_SOURCE_EVIDENCE);
  });

  test("Foodics exact name is identity evidence, not a menu write", () => {
    const unique = classifyFoodicsProductIdentity("7up", catalog.foodicsProducts);
    expect(unique.class).toBe("EXACT_FOODICS_PRODUCT_NAME_MATCH");
    expect(unique.sku).toBe("sk-1184");
    const multi = classifyFoodicsProductIdentity("Passionfruit Mojito", catalog.foodicsProducts);
    expect(multi.class).toBe("FOODICS_PRODUCT_NAME_AMBIGUOUS");
  });

  test("bundled Brand catalog says Steak salt is table salt, not Maldon", () => {
    const steak = liveCatalog.dishes.find((dish) => dish.dish === "BLACK ANGUS, BLACK PEPPERCORN");
    expect(steak.lines.some((line) => /table salt/i.test(line.name) && line.qty === "3")).toBe(true);
    expect(steak.lines.some((line) => /maldon/i.test(line.name))).toBe(false);
    const toast = liveCatalog.dishes.find((dish) => /SPECULOOS FRENCH TOAST/.test(dish.dish));
    expect(toast.lines.find((line) => /honey/i.test(line.name))).toEqual({ name: "Honey", qty: "20", unit: "gram" });
    const salad = liveCatalog.dishes.find((dish) => dish.dish === "HOUSE SALAD WITH HAZELNUT SALT");
    expect(salad.lines.some((line) => /honey/i.test(line.name))).toBe(false);
  });

  test("missing catalog does not invent source confirmation", () => {
    const evidence = compareDraftToSource({
      recipeName: "RIGATONI",
      draftLines: [],
      catalog: null,
    });
    expect(evidence.class).toBe(SOURCE_EVIDENCE_CLASS.SOURCE_CATALOG_UNAVAILABLE);
  });
});
