const { buildPriceSnapshot, decimalToMinor, sumStoredMinor } = require("./priceSnapshot");

const eggs = {
  id: "7b879a69-8d4d-4853-8bea-544266c9cf61",
  name_en: "2 Eggs Any Style",
  price: "31 SAR",
};
const bacon = { id: "f8bc8ee0-562c-47f5-821b-23714ad8aa5f", name: "Beef Bacon", price: "19 SAR" };
const fried = { id: "fried", name: "Fried", price: 0 };

test("a submitted eggs line freezes the catalogue price in minor units", () => {
  const first = buildPriceSnapshot({ item: eggs, quantity: 2, modifiers: [fried, bacon] });
  expect(first).toMatchObject({
    catalogueItemId: eggs.id,
    name: "2 Eggs Any Style",
    quantity: 2,
    baseUnitMinor: 3100,
    unitMinor: 5000,
    lineMinor: 10000,
    currency: "SAR",
    taxMinor: null,
  });
  expect(first.modifiers).toEqual([
    { id: "fried", name: "Fried", unitMinor: 0 },
    { id: bacon.id, name: "Beef Bacon", unitMinor: 1900 },
  ]);

  const changed = { ...eggs, price: "40 SAR" };
  const changedBacon = { ...bacon, price: "25 SAR" };
  const next = buildPriceSnapshot({ item: changed, quantity: 2, modifiers: [fried, changedBacon] });
  expect(first.lineMinor).toBe(10000);
  expect(first.modifiers[1].unitMinor).toBe(1900);
  expect(next.baseUnitMinor).toBe(4000);
  expect(next.modifiers[1].unitMinor).toBe(2500);
  expect(next.unitMinor).toBe(6500);
  expect(next.lineMinor).toBe(13000);
});

test("minor units reject a third decimal instead of rounding it", () => {
  expect(decimalToMinor("19.999 SAR")).toBeNull();
  expect(decimalToMinor("19.10 SAR")).toBe(1910);
  expect(decimalToMinor(31)).toBe(3100);
});

test("cashier totals use persisted minor units and mark a reconstructed line", () => {
  const saved = buildPriceSnapshot({ item: eggs, quantity: 2, modifiers: [fried, bacon] });
  const check = sumStoredMinor([
    { lineMinor: saved.lineMinor, provenance: "snapshot" },
  ]);
  expect(check).toEqual({ minor: 10000, provenance: "snapshot" });
  const mixed = sumStoredMinor([
    { lineMinor: saved.lineMinor, provenance: "snapshot" },
    { lineMinor: 3100, provenance: "reconstructed" },
  ]);
  expect(mixed).toEqual({ minor: 13100, provenance: "reconstructed" });
});
