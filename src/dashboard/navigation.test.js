import {
  INTELLIGENCE_NAV_COMMANDS,
  INTELLIGENCE_SECONDARY_TABS,
  INTELLIGENCE_TAB_ALIASES,
  INTELLIGENCE_TABS,
  NAV_ITEMS,
  adminViewFromLocation,
  isScrollableView,
  navIdFromLegacyView,
  normalizeIntelligenceTabId,
  resolveIntelligenceDestination,
} from "./navigation";

describe("intelligence navigation", () => {
  test("exposes five primary manager-facing tabs including Knowledge", () => {
    expect(INTELLIGENCE_TABS.map((tab) => tab.id)).toEqual([
      "ask",
      "operations",
      "commercial",
      "market",
      "knowledge",
    ]);
  });

  test("normalizeIntelligenceTabId maps legacy aliases to new primaries", () => {
    expect(normalizeIntelligenceTabId("ai")).toBe("ask");
    expect(normalizeIntelligenceTabId("executive")).toBe("operations");
    expect(normalizeIntelligenceTabId("restaurant")).toBe("operations");
    expect(normalizeIntelligenceTabId("sales")).toBe("commercial");
    expect(normalizeIntelligenceTabId("imports")).toBe("commercial");
    expect(normalizeIntelligenceTabId("menu")).toBe("commercial");
    expect(normalizeIntelligenceTabId("visual")).toBe("market");
    expect(normalizeIntelligenceTabId("competitive")).toBe("market");
    expect(normalizeIntelligenceTabId("predictive")).toBe("ask");
  });

  test("normalizeIntelligenceTabId preserves new primary tabs", () => {
    expect(normalizeIntelligenceTabId("operations")).toBe("operations");
    expect(normalizeIntelligenceTabId("commercial")).toBe("commercial");
    expect(normalizeIntelligenceTabId("market")).toBe("market");
    expect(normalizeIntelligenceTabId("ask")).toBe("ask");
    expect(normalizeIntelligenceTabId("knowledge")).toBe("knowledge");
    expect(normalizeIntelligenceTabId("vault")).toBe("knowledge");
  });

  test("defaults empty tab to ask", () => {
    expect(normalizeIntelligenceTabId("")).toBe("ask");
    expect(normalizeIntelligenceTabId(null)).toBe("ask");
  });

  test("resolveIntelligenceDestination maps old modules to secondary views", () => {
    expect(resolveIntelligenceDestination("executive")).toEqual({
      primary: "operations",
      secondary: "overview",
    });
    expect(resolveIntelligenceDestination("restaurant")).toEqual({
      primary: "operations",
      secondary: "staff",
    });
    expect(resolveIntelligenceDestination("sales")).toEqual({
      primary: "commercial",
      secondary: "sales",
    });
    expect(resolveIntelligenceDestination("menu")).toEqual({
      primary: "commercial",
      secondary: "menu",
    });
    expect(resolveIntelligenceDestination("visual")).toEqual({
      primary: "market",
      secondary: "visual",
    });
    expect(resolveIntelligenceDestination("competitive")).toEqual({
      primary: "market",
      secondary: "competitors",
    });
  });

  test("secondary taxonomy matches suggested structure", () => {
    expect(INTELLIGENCE_SECONDARY_TABS.operations.map((t) => t.id)).toEqual([
      "overview",
      "staff",
      "diagnostics",
    ]);
    expect(INTELLIGENCE_SECONDARY_TABS.commercial.map((t) => t.id)).toEqual([
      "sales",
      "menu",
    ]);
    expect(INTELLIGENCE_SECONDARY_TABS.market.map((t) => t.id)).toEqual([
      "visual",
      "competitors",
    ]);
  });

  test("command palette covers primary destinations and useful shortcuts", () => {
    const labels = INTELLIGENCE_NAV_COMMANDS.map((cmd) => cmd.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Go to Ask NAC",
        "Go to Operations",
        "Go to Commercial",
        "Go to Market",
        "Go to Knowledge",
        "Go to Sales",
        "Go to Menu",
        "Go to Competitors",
      ]),
    );
    expect(labels.some((label) => /Command Center/i.test(label))).toBe(false);
  });

  test("alias map covers legacy module ids", () => {
    expect(INTELLIGENCE_TAB_ALIASES.executive).toBe("operations");
    expect(INTELLIGENCE_TAB_ALIASES.sales).toBe("commercial");
    expect(INTELLIGENCE_TAB_ALIASES.competitive).toBe("market");
  });
});

describe("NAC OS Food Bible navigation", () => {
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
