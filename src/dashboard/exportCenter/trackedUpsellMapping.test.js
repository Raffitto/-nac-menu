import { matchTrackedUpsell } from "./trackedUpsellCatalog";

describe("August tracked-upsell source aliases", () => {
  test("Blackberry & Vanilla, Lemon maps only to Vanilla Mocktail", () => {
    const hit = matchTrackedUpsell("Blackberry & Vanilla, Lemon");
    expect(hit.status).toBe("mapped");
    expect(hit.displayName).toBe("Vanilla Mocktail");
    expect(matchTrackedUpsell("Vanilla Mocktail").displayName).toBe("Vanilla Mocktail");
  });

  test("Sea Bass Creaole is an explicit typo alias for Sea Bass Creole", () => {
    const hit = matchTrackedUpsell("Sea Bass Creaole");
    expect(hit.status).toBe("mapped");
    expect(hit.displayName).toBe("Sea Bass Creole");
    expect(matchTrackedUpsell("Sea Bass Creole").displayName).toBe("Sea Bass Creole");
  });

  test("Big NAC New maps to Big NAC New and Big Nac does not", () => {
    expect(matchTrackedUpsell("Big NAC New").displayName).toBe("Big NAC New");
    expect(matchTrackedUpsell("Big Nac").status).toBe("unmapped");
    expect(matchTrackedUpsell("Big NAC").status).toBe("unmapped");
  });

  test("explicit aliases do not introduce loose vanilla / sea bass / burger collisions", () => {
    expect(matchTrackedUpsell("Vanilla Syrup").status).toBe("unmapped");
    expect(matchTrackedUpsell("Blackberry").status).toBe("unmapped");
    expect(matchTrackedUpsell("Vanilla").status).toBe("unmapped");
    expect(matchTrackedUpsell("Sea Bass").status).toBe("unmapped");
    expect(matchTrackedUpsell("Halloumi Fries").status).toBe("unmapped");
    expect(matchTrackedUpsell("Watermelon & Feta Salad").displayName).toBe("Watermelon & Feta Salad");
    expect(matchTrackedUpsell("Watermelon, Mint & Lemon").displayName).toBe("Mocktail - Watermelon & Mint, Lemon");
  });
});
