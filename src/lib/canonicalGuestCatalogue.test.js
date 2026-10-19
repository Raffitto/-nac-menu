import {
  isActiveBigNac,
  isRetiredBigNac,
  presentGuestMenuItem,
} from "./canonicalGuestCatalogue";
import { filterPublicMenuData } from "./menuVisibility";

test("every branch shows Khobar's Big NAC without replacing the stored row", () => {
  const khobar = { id: "kh", branch_id: "khobar", en: "Big NAC", calories: 1115, price: "69 SAR", active: true };
  const riyadh = { id: "ry", branch_id: "riyadh", en: "Big Nac", calories: 1100, price: "68", active: true };
  const quinoa = { en: "Quinoa", calories: 269, price: "45 SAR", active: true };

  expect(isActiveBigNac(khobar)).toBe(true);
  expect(isRetiredBigNac(riyadh)).toBe(true);
  expect(presentGuestMenuItem(khobar)).toBe(khobar);

  const menu = filterPublicMenuData({
    evening: [{ title: { en: "Mains" }, items: [riyadh, quinoa] }],
  });

  expect(menu.evening[0].items.map((item) => item.en)).toEqual(["Big NAC", "Quinoa"]);
  expect(menu.evening[0].items[0]).toMatchObject({
    id: "ry",
    branch_id: "riyadh",
    en: "Big NAC",
    price: "69 SAR",
    calories: 1115,
  });
});
