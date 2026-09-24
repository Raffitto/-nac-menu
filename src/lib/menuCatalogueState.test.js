import { menuCatalogueView } from "./menuCatalogueState";

describe("menu catalogue view", () => {
  test("failed read with no rows is not an empty catalogue", () => {
    expect(menuCatalogueView({
      loading: false,
      error: "Categories did not load.",
      categoryCount: 0,
    })).toBe("failed");
  });

  test("a genuine empty catalogue is distinct from a failure", () => {
    expect(menuCatalogueView({
      loading: false,
      error: "",
      categoryCount: 0,
    })).toBe("empty");
  });

  test("loading does not look empty or failed", () => {
    expect(menuCatalogueView({
      loading: true,
      error: "",
      categoryCount: 0,
    })).toBe("loading");
  });

  test("loaded rows stay visible when a later refresh fails", () => {
    expect(menuCatalogueView({
      loading: false,
      error: "Categories did not load.",
      categoryCount: 4,
    })).toBe("stale");
  });

  test("success with data is ready", () => {
    expect(menuCatalogueView({
      loading: false,
      error: "",
      categoryCount: 4,
    })).toBe("ready");
  });
});
