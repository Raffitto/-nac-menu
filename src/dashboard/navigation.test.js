import {
  INTELLIGENCE_TAB_ALIASES,
  NAV_ITEMS,
  adminViewFromLocation,
  isScrollableView,
  navIdFromLegacyView,
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

describe("NAC OS navigation", () => {
  test("exposes Food Bible as a primary nav item", () => {
    expect(NAV_ITEMS.map((item) => item.id)).toContain("food-bible");
    expect(NAV_ITEMS.find((item) => item.id === "food-bible").label).toBe("Food Bible");
    expect(navIdFromLegacyView("recipes")).toBe("food-bible");
    expect(isScrollableView("food-bible")).toBe(true);
  });

  test("reads Food Bible from the admin view query", () => {
    window.history.replaceState({}, "", "/?view=food-bible");
    expect(adminViewFromLocation()).toBe("food-bible");
    window.history.replaceState({}, "", "/?view=recipes");
    expect(adminViewFromLocation()).toBe("food-bible");
    window.history.replaceState({}, "", "/");
    expect(adminViewFromLocation()).toBe("overview");
  });
});
