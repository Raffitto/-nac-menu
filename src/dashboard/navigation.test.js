import {
  INTELLIGENCE_TAB_ALIASES,
  normalizeIntelligenceTabId,
} from "./navigation";

describe("intelligence navigation", () => {
  test("normalizeIntelligenceTabId maps legacy aliases", () => {
    expect(normalizeIntelligenceTabId("ai")).toBe("ask");
    expect(normalizeIntelligenceTabId("imports")).toBe("sales");
    expect(normalizeIntelligenceTabId("operations")).toBe("restaurant");
    expect(normalizeIntelligenceTabId("predictive")).toBe("ask");
  });

  test("normalizeIntelligenceTabId preserves canonical tabs", () => {
    expect(normalizeIntelligenceTabId("menu")).toBe("menu");
    expect(normalizeIntelligenceTabId("visual")).toBe("visual");
    expect(normalizeIntelligenceTabId("competitive")).toBe("competitive");
  });

  test("defaults empty tab to ask", () => {
    expect(normalizeIntelligenceTabId("")).toBe("ask");
    expect(normalizeIntelligenceTabId(null)).toBe("ask");
  });

  test("alias map covers legacy ids", () => {
    expect(INTELLIGENCE_TAB_ALIASES.imports).toBe("sales");
    expect(INTELLIGENCE_TAB_ALIASES.operations).toBe("restaurant");
  });
});
