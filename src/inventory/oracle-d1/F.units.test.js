/**
 * Oracle D1 — F. Units (T24-T26). One alias table: inventoryIntelligence
 * MEASUREMENT_UNIT_ALIASES (recipes) + PACKAGING_UNIT_ALIASES (purchasing only).
 */
import {
  MEASUREMENT_UNIT_ALIASES,
  normalizeMeasurementUnit,
  normalizeUnit,
  PACKAGING_UNIT_ALIASES,
  UNIT_ALIASES,
} from "../inventoryIntelligence";
import { normalizeRecipeUnit, resolveRecipeLineUom } from "../truth/uom";
import { normUnit } from "../intelligence/recipeExplosion";
import { CONVERSION_STATUS } from "../truth/contracts";
import { summarizeIngredientConsumptionWithTruth } from "../truth/ingredientConsumption";
import { allTrackedWriteCalls } from "../__fixtures__/oracle-d1/supabaseStub";
import { SYN_BRANCH, SYN_INGREDIENTS, synGraph } from "../__fixtures__/oracle-d1/synFixtures";

const MILK = { id: SYN_INGREDIENTS.milk.id, name: SYN_INGREDIENTS.milk.canonical_name };
const DAY = { start: "2026-10-10", end: "2026-10-10", label: "2026-10-10" };

describe("T24 ltr alias", () => {
  test("1 ltr -> 1000 millilitre CONVERTED", () => {
    expect(resolveRecipeLineUom({ quantity: "1", unit: "ltr", baseUom: "millilitre" })).toMatchObject({
      conversionStatus: CONVERSION_STATUS.CONVERTED,
      quantityBase: "1000",
      baseUom: "millilitre",
    });
  });

  test.each([
    ["Gm", "gram", "gram", "5"],
    ["Ml", "millilitre", "millilitre", "5"],
    ["Pcs", "each", "each", "5"],
    ["l", "millilitre", "litre", "5000"],
    ["L", "millilitre", "litre", "5000"],
  ])("%s resolves", (unit, baseUom, canonical, expected) => {
    expect(normalizeRecipeUnit(unit)).toBe(canonical);
    const resolved = resolveRecipeLineUom({ quantity: "5", unit, baseUom });
    expect([CONVERSION_STATUS.EXACT, CONVERSION_STATUS.CONVERTED]).toContain(resolved.conversionStatus);
    expect(Number(resolved.quantityBase)).toBe(Number(expected));
  });
});

function twoProductGraph(unitA, qtyA, unitB, qtyB) {
  return synGraph([
    { id: "SYN-R-A", name: "SYN-A", menuItemId: "SYN-M-A", lines: [{ ingredientId: MILK.id, quantity: qtyA, unit: unitA }] },
    { id: "SYN-R-B", name: "SYN-B", menuItemId: "SYN-M-B", lines: [{ ingredientId: MILK.id, quantity: qtyB, unit: unitB }] },
  ]);
}
const ONE_EACH = [
  { matched_menu_item_id: "SYN-M-A", raw_item_name: "SYN-A", quantity_sold: 1, business_date: "2026-10-10" },
  { matched_menu_item_id: "SYN-M-B", raw_item_name: "SYN-B", quantity_sold: 1, business_date: "2026-10-10" },
];

describe("T25 mixed units are never summed raw", () => {
  test("1 ltr + 100 Ml = 1100 millilitre", () => {
    const result = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK, branchId: SYN_BRANCH, window: DAY, salesRows: ONE_EACH,
      graphInput: twoProductGraph("ltr", "1", "Ml", "100"),
      sales: { complete: true, orderStatusVerified: true },
    });
    expect(result.status).toBe("PROVISIONAL");
    expect(result.quantity).toBe("1100");
    expect(result.unit).toBe("millilitre");
    expect(result.postsStock).toBe(false);
  });

  test("100 gram + 100 Ml for a millilitre ingredient -> UNAVAILABLE (incompatible units)", () => {
    const result = summarizeIngredientConsumptionWithTruth({
      ingredient: MILK, branchId: SYN_BRANCH, window: DAY, salesRows: ONE_EACH,
      graphInput: twoProductGraph("gram", "100", "Ml", "100"),
      sales: { complete: true, orderStatusVerified: true },
    });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.quantity).toBeNull();
    expect(result.reason).toMatch(/incompatible units/);
    expect(JSON.stringify(result)).not.toMatch(/"(101 ltr|200 Ml)"/);
    expect(result.postsStock).toBe(false);
  });
});

describe("T26 one alias table", () => {
  const measurement = Object.keys(MEASUREMENT_UNIT_ALIASES);
  const packaging = Object.keys(PACKAGING_UNIT_ALIASES);
  const variants = (alias) => [alias, alias.toUpperCase(), alias[0].toUpperCase() + alias.slice(1), ` ${alias} `];

  test("the union is the measurement table plus the packaging table", () => {
    expect(Object.keys(UNIT_ALIASES).sort()).toEqual([...new Set([...measurement, ...packaging])].sort());
    expect(MEASUREMENT_UNIT_ALIASES.ltr).toBe("litre");
  });

  test.each(measurement)("measurement alias %s: every normaliser agrees", (alias) => {
    for (const value of variants(alias)) {
      const canonical = MEASUREMENT_UNIT_ALIASES[alias];
      expect(normalizeUnit(value)).toBe(canonical);
      expect(normalizeMeasurementUnit(value)).toBe(canonical);
      expect(normalizeRecipeUnit(value)).toBe(canonical);
      expect(normUnit(value)).toBe(canonical);
    }
  });

  test.each(packaging)("packaging alias %s: purchasing maps to each; recipe normalisers refuse it", (alias) => {
    expect(normalizeUnit(alias)).toBe("each");
    expect(normalizeRecipeUnit(alias)).toBeNull();
    expect(normalizeMeasurementUnit(alias)).toBeNull();
    expect(normUnit(alias)).toBe(alias);
  });
});

describe("T28 (F)", () => {
  test("no insert/update/upsert/delete/rpc on any stub in this file", () => {
    expect(allTrackedWriteCalls()).toEqual([]);
  });
});
