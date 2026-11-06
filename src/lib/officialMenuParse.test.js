import fs from "fs";
import path from "path";
import { OFFICIAL_ALLERGENS } from "./officialMenuAllergens";
import { candidateFoodicsMatches, parseOfficialMenuText } from "./officialMenuParse";
import products from "../inventory/intelligence/data/foodicsProductIndex.json";

const textDir = path.resolve(__dirname, "../catalogue/official-text");

function readMenu(name) {
  return fs.readFileSync(path.join(textDir, name), "utf8");
}

function byName(items, needle) {
  return items.find((item) => item.name.toLowerCase().includes(needle));
}

describe("official menu PDFs", () => {
  const menus = {
    breakfast: parseOfficialMenuText(readMenu("breakfast-en.txt"), "breakfast-en"),
    daytime: parseOfficialMenuText(readMenu("daytime-en.txt"), "daytime-en"),
    dessert: parseOfficialMenuText(readMenu("dessert-en.txt"), "dessert-en"),
    evening: parseOfficialMenuText(readMenu("evening-en.txt"), "evening-en"),
    seasonal: parseOfficialMenuText(readMenu("seasonal-en.txt"), "seasonal-en"),
  };
  const confident = Object.values(menus).flat().filter((item) => item.association === "name-calorie-price");

  test("keeps printed calories, prices, and full allergen names", () => {
    const eggs = byName(menus.breakfast, "2 eggs any style");
    expect(eggs).toMatchObject({ calories: 461.4, priceSar: 31, allergenNames: ["Gluten", "Eggs"] });
    const toast = byName(menus.dessert, "speculoos");
    expect(toast).toMatchObject({ calories: 462, priceSar: 55 });
    expect(toast.allergenNames).toEqual(expect.arrayContaining(["Gluten", "Dairy"]));
    const prawn = byName(menus.seasonal, "king prawn");
    expect(prawn).toMatchObject({ calories: 472, priceSar: 62 });
    expect(prawn.allergenCodes).toEqual(expect.arrayContaining(["cr", "f", "sul"]));
    expect(OFFICIAL_ALLERGENS.cr.en).toBe("Crustaceans");
    expect(OFFICIAL_ALLERGENS.sul.en).toBe("Sulphite");
  });

  test("does not treat a shared Foodics name as a verified mapping", () => {
    const eggs = byName(menus.breakfast, "2 eggs any style");
    const match = candidateFoodicsMatches(eggs, products.products);
    expect(["unique_name_candidate", "ambiguous_name", "unmatched"]).toContain(match.status);
    expect(match.status).not.toBe("mapped");
    const overlap = candidateFoodicsMatches(
      { name: "French Toast" },
      [
        { id: "pos-a", name: "French Toast", sku: "sk-0647" },
        { id: "pos-b", name: "French Toast", sku: "sk-1461" },
      ],
    );
    expect(overlap.status).toBe("ambiguous_name");
  });

  test("reports how many priced dishes were read without inventing the rest", () => {
    expect(confident.length).toBeGreaterThan(40);
    expect(confident.every((item) => item.calories > 0 && item.priceSar > 0)).toBe(true);
    const summary = {};
    for (const [menu, items] of Object.entries(menus)) {
      summary[menu] = {
        confident: items.filter((item) => item.association === "name-calorie-price").length,
        review: items.filter((item) => item.association === "price-before-name").length,
      };
    }
    expect(summary.dessert.confident).toBeGreaterThanOrEqual(5);
    expect(summary.seasonal.confident).toBeGreaterThanOrEqual(4);
    const all = Object.values(menus).flat();
    const candidates = { unique_name_candidate: 0, short_name_needs_review: 0, ambiguous_name: 0, unmatched: 0 };
    for (const item of all.filter((row) => row.association === "name-calorie-price")) {
      candidates[candidateFoodicsMatches(item, products.products).status] += 1;
    }
    expect(candidates).toEqual({
      unique_name_candidate: 5,
      short_name_needs_review: 4,
      ambiguous_name: 1,
      unmatched: 62,
    });
    expect(summary).toEqual({
      breakfast: { confident: 14, review: 3 },
      daytime: { confident: 26, review: 1 },
      dessert: { confident: 6, review: 0 },
      evening: { confident: 21, review: 0 },
      seasonal: { confident: 5, review: 0 },
    });
  });
});
