import {
  isActiveBigNac,
  isRetiredBigNac,
  presentGuestMenuItem,
} from "./canonicalGuestCatalogue";
import { filterPublicMenuData } from "./menuVisibility";

test("the active Big NAC stays visible under the guest name and the retired dish does not", () => {
  const active = { en: "Big Nac", calories: 1115, price: "69 SAR", active: true };
  const retired = { en: "Big Nac", calories: 1100, price: "68", active: true };
  const quinoa = { en: "Quinoa", calories: 269, price: "45 SAR", active: true };

  expect(isActiveBigNac(active)).toBe(true);
  expect(isRetiredBigNac(retired)).toBe(true);
  expect(isRetiredBigNac(active)).toBe(false);
  expect(presentGuestMenuItem(active).en).toBe("Big NAC");
  expect(presentGuestMenuItem(active).calories).toBe(1115);
  expect(presentGuestMenuItem(active).price).toBe("69 SAR");

  const menu = filterPublicMenuData({
    evening: [{ title: { en: "Mains" }, items: [active, retired, quinoa] }],
  });

  expect(menu.evening[0].items.map((item) => item.en)).toEqual(["Big NAC", "Quinoa"]);
});
