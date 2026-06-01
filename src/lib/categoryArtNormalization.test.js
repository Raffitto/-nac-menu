import {
  CATEGORY_ART_NORMALIZATION,
  getCategoryArtStyle,
} from "./categoryArtNormalization";
import { CATEGORY_SELECTOR_ORDER } from "./menuPresentation";

describe("categoryArtNormalization", () => {
  test("every selector category has en and ar tuning", () => {
    for (const id of CATEGORY_SELECTOR_ORDER) {
      expect(CATEGORY_ART_NORMALIZATION[id]).toBeDefined();
      expect(CATEGORY_ART_NORMALIZATION[id].en).toBeDefined();
      expect(CATEGORY_ART_NORMALIZATION[id].ar).toBeDefined();
    }
  });

  test("arabic scales are at least english for optical parity", () => {
    for (const id of CATEGORY_SELECTOR_ORDER) {
      const { en, ar } = CATEGORY_ART_NORMALIZATION[id];
      expect(ar.scale).toBeGreaterThanOrEqual(en.scale);
    }
  });

  test("getCategoryArtStyle returns CSS variables", () => {
    const style = getCategoryArtStyle("evening", true);
    expect(style["--art-scale"]).toBe("1.58");
    expect(style["--art-x"]).toMatch(/px$/);
    expect(style["--art-y"]).toMatch(/px$/);
  });
});
