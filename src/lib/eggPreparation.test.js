import {
  DEFAULT_EGG_PREPARATION_ID,
  EGG_PREPARATIONS,
  eggHeroImage,
  eggPreparationSelection,
  isTwoEggsAnyStyle,
  openEggPreparation,
  resetEggPreparation,
  selectEggPreparation,
  withEggPreparations,
} from "./eggPreparation";

const eggs = {
  id: "item-eggs",
  en: "2 Eggs Any Style",
  ar: "٢ بيض من أي نوع",
  price: "31 SAR",
  calories: 461.4,
  image: "/2-eggs.jpg",
  allergens: ["e", "g"],
  recommended: [{ en: "Avocado Slices", price: "15 SAR" }],
};

describe("2 Eggs Any Style preparation", () => {
  test("keeps one product, the 31 SAR price, and defaults to scrambled", () => {
    const prepared = withEggPreparations(eggs);
    expect(prepared.id).toBe("item-eggs");
    expect(prepared.price).toBe("31 SAR");
    expect(prepared.calories).toBe(461.4);
    expect(prepared.allergens).toEqual(["e", "g"]);
    expect(prepared.recommended).toHaveLength(1);
    expect(prepared.preparations.map((option) => option.id)).toEqual(["fried", "scrambled", "poached"]);
    expect(prepared.selectedPreparationId).toBe(DEFAULT_EGG_PREPARATION_ID);
    expect(prepared.preparationSelection).toEqual({
      groupId: "egg_preparation",
      optionId: "scrambled",
      labelEn: "Scrambled",
      labelAr: "مخفوق",
      priceDeltaSar: 0,
      image: "/eggs-scrambled.webp",
    });
    expect(EGG_PREPARATIONS).toHaveLength(3);
    expect(eggHeroImage(prepared)).toBe("/eggs-scrambled.webp");
  });

  test("selecting fried changes only the preparation and photograph", () => {
    const selected = selectEggPreparation(withEggPreparations(eggs), "fried");
    expect(selected.price).toBe("31 SAR");
    expect(selected.allergens).toEqual(["e", "g"]);
    expect(selected.recommended).toEqual(eggs.recommended);
    expect(selected.id).toBe("item-eggs");
    expect(selected.en).toBe("2 Eggs Any Style");
    expect(selected.image).toBe("/eggs-fried-menu.webp");
    expect(eggHeroImage(selected)).toBe("/eggs-fried-menu.webp");
    expect(selected.preparationSelection.image).toBe("/eggs-fried-menu.webp");
    expect(selected.preparationSelection.optionId).toBe("fried");
    expect(selected.preparationSelection.priceDeltaSar).toBe(0);
    expect(eggPreparationSelection("poached").labelAr).toBe("مسلوق");
  });

  test("other dishes are left unchanged", () => {
    const shakshuka = { en: "Shakshuka", price: "49 SAR", calories: 575, image: "/shakshuka.jpg" };
    const scrambled = {
      en: "Scrambled Eggs",
      price: "49 SAR",
      calories: 751,
      image: "/scrambled-eggs.jpg",
    };
    const wrongPrice = { ...eggs, price: "49 SAR" };
    const lookalike = { ...eggs, en: "2 Eggs Any Style Special" };
    expect(withEggPreparations(shakshuka)).toBe(shakshuka);
    expect(withEggPreparations(scrambled)).toBe(scrambled);
    expect(isTwoEggsAnyStyle(wrongPrice)).toBe(false);
    expect(isTwoEggsAnyStyle(lookalike)).toBe(false);
    expect(isTwoEggsAnyStyle({ ...eggs, en: "  2 eggs any style  " })).toBe(true);
  });

  test("a collage photograph opens that preparation and the title opens scrambled", () => {
    const fried = openEggPreparation(eggs, "fried");
    expect(fried.selectedPreparationId).toBe("fried");
    expect(fried.preparationSelection.optionId).toBe("fried");
    expect(fried.price).toBe("31 SAR");
    expect(eggHeroImage(fried)).toBe("/eggs-fried-menu.webp");
    expect(openEggPreparation(eggs).selectedPreparationId).toBe("scrambled");
    expect(openEggPreparation(eggs, "poached").preparationSelection.image).toBe("/eggs-poached.webp");
    expect(openEggPreparation({ en: "Scrambled Eggs", price: "49 SAR", calories: 751 }).preparations).toBeUndefined();
  });

  test("reopening starts again at scrambled and does not keep another product's choice", () => {
    const fried = selectEggPreparation(withEggPreparations(eggs), "fried");
    const reopened = resetEggPreparation(fried);
    expect(reopened.selectedPreparationId).toBe("scrambled");
    expect(reopened.preparationSelection.optionId).toBe("scrambled");
    expect(reopened.price).toBe("31 SAR");
    expect(eggHeroImage(reopened)).toBe("/eggs-scrambled.webp");
    expect(resetEggPreparation({ en: "Turkish Eggs", price: "49 SAR", calories: 698 })).toEqual({
      en: "Turkish Eggs",
      price: "49 SAR",
      calories: 698,
    });
  });
});
