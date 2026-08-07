import { filterCountTotals } from "./inventoryOperations";

const rows = [
  {
    ingredient_id: "complete",
    expected_quantity: 24,
    variance_quantity: -16.5,
    variance_value: -462,
    has_uncounted_location: false,
    has_warning: false,
    has_unresolved_unit: false,
  },
  {
    ingredient_id: "uncounted",
    expected_quantity: 10,
    variance_quantity: null,
    variance_value: null,
    has_uncounted_location: true,
    has_warning: false,
    has_unresolved_unit: false,
  },
  {
    ingredient_id: "warning",
    expected_quantity: 24,
    variance_quantity: 976,
    variance_value: 0,
    has_uncounted_location: false,
    has_warning: true,
    has_unresolved_unit: false,
  },
  {
    ingredient_id: "unit",
    expected_quantity: 1,
    variance_quantity: 0,
    variance_value: 0,
    has_uncounted_location: false,
    has_warning: false,
    has_unresolved_unit: true,
  },
];

describe("count session filters", () => {
  test.each([
    ["uncounted", ["uncounted"]],
    ["warnings", ["warning"]],
    ["high-value", ["complete"]],
    ["high-percentage", ["complete", "warning"]],
    ["unresolved-units", ["unit"]],
  ])("filters %s rows", (filter, expected) => {
    expect(filterCountTotals(rows, filter).map(({ ingredient_id: id }) => id)).toEqual(expected);
  });

  test("returns all rows for the all filter", () => {
    expect(filterCountTotals(rows, "all")).toBe(rows);
  });
});
