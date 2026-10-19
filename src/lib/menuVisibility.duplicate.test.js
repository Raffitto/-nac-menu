import { filterPublicMenuData, isGuestCatalogueDuplicate } from "./menuVisibility";

const original = {
  en: "2 Eggs Any Style",
  price: "31 SAR",
  calories: 461.4,
  active: true,
};

const copy = {
  en: "2 Eggs Any Style (Copy)",
  price: "31 SAR",
  calories: 461.4,
  active: true,
};

test("the guest catalogue hides only the 2 Eggs Any Style duplicate", () => {
  expect(isGuestCatalogueDuplicate(copy)).toBe(true);
  expect(isGuestCatalogueDuplicate({ name_en: "2 Eggs Any Style (Copy)" })).toBe(true);
  expect(isGuestCatalogueDuplicate(original)).toBe(false);
  expect(isGuestCatalogueDuplicate({ en: "Scrambled Eggs" })).toBe(false);

  const menu = filterPublicMenuData({
    brunch: [
      {
        title: { en: "Eggs" },
        items: [original, copy, { en: "Scrambled Eggs", calories: 869.25, price: "49 SAR", active: true }],
      },
    ],
  });

  expect(menu.brunch[0].items.map((item) => item.en)).toEqual([
    "2 Eggs Any Style",
    "Scrambled Eggs",
  ]);
});
