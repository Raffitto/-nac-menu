import { summarizeSelectionAggregates } from "./selectionAggregates";

describe("summarizeSelectionAggregates", () => {
  test("all visible → Hide", () => {
    const result = summarizeSelectionAggregates([
      { id: "a", active: true, hidden_until: null, sold_out: false },
      { id: "b", active: true, hidden_until: null, sold_out: false },
    ]);
    expect(result.visibilityMode).toBe("visible");
    expect(result.visibilityLabel).toBe("Hide");
    expect(result.soldOutMode).toBe("available");
    expect(result.soldOutLabel).toBe("Sold Out");
  });

  test("all hidden → Show", () => {
    const result = summarizeSelectionAggregates([
      { id: "a", active: false, sold_out: true },
      { id: "b", active: false, sold_out: true },
    ]);
    expect(result.visibilityMode).toBe("hidden");
    expect(result.visibilityLabel).toBe("Show");
    expect(result.soldOutMode).toBe("sold_out");
    expect(result.soldOutLabel).toBe("Available");
  });

  test("mixed visibility and status", () => {
    const result = summarizeSelectionAggregates([
      { id: "a", active: true, sold_out: false },
      { id: "b", active: false, sold_out: true },
    ]);
    expect(result.visibilityMode).toBe("mixed");
    expect(result.visibilityLabel).toBe("Visibility…");
    expect(result.soldOutMode).toBe("mixed");
    expect(result.soldOutLabel).toBe("Status…");
  });
});
