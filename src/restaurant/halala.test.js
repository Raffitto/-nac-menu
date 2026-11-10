const { amountStillOwed, canSettle, equalSplit, inclusiveVat, percentMinor, sumMinor } = require("./halala");

test("a VAT-inclusive price separates the taxable amount without changing the gross", () => {
  const tax = inclusiveVat(10000, 15, 100);
  expect(tax).toEqual({
    treatment: "inclusive",
    grossMinor: 10000,
    vatMinor: 1304,
    taxableMinor: 8696,
    rateNumerator: 15,
    rateDenominator: 100,
  });
  expect(tax.taxableMinor + tax.vatMinor).toBe(10000);
  expect(inclusiveVat(1, 15, 100)).toMatchObject({ vatMinor: 0, taxableMinor: 1 });
  expect(inclusiveVat(115, 15, 100)).toMatchObject({ vatMinor: 15, taxableMinor: 100 });
});

test("split checks do not reduce the amount still owed", () => {
  expect(amountStillOwed(9500, 4000)).toBe(5500);
  expect(canSettle(9500, 4000)).toBe(false);
  expect(canSettle(9500, 9500)).toBe(true);
  expect(amountStillOwed(9000, 0)).toBe(9000);
});

test("equal splits keep the odd halala on the last share", () => {
  expect(equalSplit(100, 3)).toEqual([33, 33, 34]);
  expect(sumMinor(equalSplit(100, 3))).toBe(100);
  expect(percentMinor(10000, 10)).toBe(1000);
  expect(percentMinor(1, 10)).toBe(0);
});
