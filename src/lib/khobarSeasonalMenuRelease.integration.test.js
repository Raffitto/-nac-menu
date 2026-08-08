import fs from "fs";
import path from "path";
import { filterPublicMenuData } from "./menuVisibility";
import { getContextualFlow } from "./contextualMenu";
import { getMenuLevelTabs } from "./menuPresentation";

const migrationPath = path.resolve(
  __dirname,
  "../../supabase/migrations/20260808190000_publish_khobar_seasonal_menu_selections.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

const IMG_BASE =
  "https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/";

const RELEASE_ITEMS = [
  {
    key: "watermelon",
    id: "a6070000-0000-4000-8000-000000000002",
    en: "Watermelon & Cucumber",
    price: "59 SAR",
    calories: "341",
    allergens: ["m", "su", "n"],
    image: `${IMG_BASE}watermelon-cucumber.jpg`,
    breakfast: true,
    primarySection: "Salads",
  },
  {
    key: "prawn",
    id: "a6070000-0000-4000-8000-000000000001",
    en: "King Prawn Rendang",
    price: "62 SAR",
    calories: "472",
    allergens: ["s", "sh", "se", "su", "f", "n", "c", "g"],
    image: `${IMG_BASE}king-prawn-rendang.jpg`,
    breakfast: false,
    primarySection: "Sides",
  },
  {
    key: "conchiglie",
    id: "a6070000-0000-4000-8000-000000000003",
    en: "Conchiglie",
    price: "79 SAR",
    calories: "800",
    allergens: ["d", "g"],
    image: `${IMG_BASE}conchiglie-wild-morels.jpg`,
    breakfast: false,
    primarySection: "Mains",
  },
  {
    key: "seabass",
    id: "a6070000-0000-4000-8000-000000000005",
    en: "Pan Seared Seabass",
    price: "72 SAR",
    calories: "430",
    allergens: ["c", "su", "d", "g", "m", "f"],
    image: `${IMG_BASE}pan-seared-seabass.jpg`,
    breakfast: false,
    primarySection: "Mains",
  },
  {
    key: "brownies",
    id: "a6070000-0000-4000-8000-000000000006",
    // Original release migration inserted "Brownies"; printed-menu correction
    // in 20260808200000 sets the live guest name/calories.
    en: "Brownies",
    allergens: ["d", "e", "g"],
    image: `${IMG_BASE}brownies.jpg`,
    breakfast: true,
    primarySection: "Desserts",
  },
];

function riyadhDate(weekdayEn, hour, minute = 0) {
  const base = {
    Sun: "2026-01-04",
    Mon: "2026-01-05",
    Tue: "2026-01-06",
    Wed: "2026-01-07",
    Thu: "2026-01-08",
    Fri: "2026-01-09",
    Sat: "2026-01-10",
  };
  const ymd = base[weekdayEn];
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${ymd}T${hh}:${mm}:00+03:00`);
}

describe("Khobar seasonal menu release migration", () => {
  test("is Khobar-scoped, idempotent, and publishes through the menu pipeline", () => {
    expect(migration).toContain("v_branch constant text := 'khobar'");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("publish_menu_branch");
    expect(migration).toContain("khobar-seasonal-menu-release-2026-08-09");
    expect(migration).toContain("on conflict (id) do update");
    expect(migration).not.toMatch(/feature\/inventory-cost-control|Food Bible|food_bible/i);
  });

  test("preserves finalized prices, calories, allergens, and optimized seasonal images", () => {
    RELEASE_ITEMS.filter((item) => item.key !== "brownies").forEach((item) => {
      expect(migration).toContain(`'${item.id}'`);
      expect(migration).toContain(`'${item.en}'`);
      expect(migration).toContain(`'${item.price}'`);
      expect(migration).toContain(`'${item.calories}'`);
      expect(migration).toContain(item.image.replace(IMG_BASE, ""));
      expect(migration).toContain(
        `array[${item.allergens.map((code) => `'${code}'`).join(", ")}]`,
      );
    });
    expect(migration).toContain("'69 SAR'");
    expect(migration).toContain("'1115'");
    expect(migration).toContain("array['g', 'd', 'e', 'm', 'su', 'se']");
    expect(migration).toContain("big-nac.jpg");
  });

  test("updates the live Big Nac group and retires the staged replacement", () => {
    expect(migration).toContain("e14ea002-2f20-4cb4-9d41-52ec13630e33");
    expect(migration).toContain("Big NAC (staged archive)");
    expect(migration).toContain("Duplicate live Big NAC detected");
    expect(migration).toContain("Expected exactly 3 active live Big NAC placements");
  });

  test("copies Brownies allergens from Cookies with Ice Cream source item", () => {
    expect(migration).toContain("91b6b95a-724c-44e8-9d09-b31e862bdc53");
    expect(migration).toContain("Crushed Milk Chocolate Cookies");
    expect(migration).toContain("Cookies with Ice Cream");
    expect(migration).toContain("a6070000-0000-4000-8000-000000000006");
    expect(migration).toContain("brownies.jpg");
    expect(migration).toContain("unnest(v_cookies_allergen_ids)");
  });

  test("places items into canonical sections and enforces breakfast rules", () => {
    expect(migration).toContain("s.name_en = 'Salads'");
    expect(migration).toContain("s.name_en = 'Sides'");
    expect(migration).toContain("s.name_en = 'Mains'");
    expect(migration).toContain("s.name_en = 'Desserts'");
    expect(migration).toContain("s.name_en = 'Plates'");
    expect(migration).toContain("s.name_en = 'Sweets'");
    expect(migration).toContain("Non-breakfast seasonal items incorrectly placed under Breakfast");
    expect(migration).toContain("c.slug = 'breakfast'");
  });
});

describe("Khobar seasonal release guest visibility model", () => {
  const publicItems = RELEASE_ITEMS.map((item) => ({
    id: item.id,
    en: item.en,
    price: item.price || "62 SAR",
    calories: item.calories || "1067",
    allergens: item.allergens,
    image: item.image,
    active: true,
  }));

  const inactiveStagedBigNac = {
    id: "a6070000-0000-4000-8000-000000000004",
    en: "Big NAC (staged archive)",
    price: "69 SAR",
    calories: "1115",
    allergens: [],
    image: `${IMG_BASE}big-nac.jpg`,
    active: false,
  };

  const liveBigNac = {
    id: "09553dff-7c0e-4255-ae8a-9c5e5bd57301",
    en: "Big NAC",
    price: "69 SAR",
    calories: "1115",
    allergens: ["g", "d", "e", "m", "su", "se"],
    image: `${IMG_BASE}big-nac.jpg`,
    active: true,
  };

  test("public filter keeps active release items and hides staged archive Big NAC", () => {
    const filtered = filterPublicMenuData({
      daytime: [
        {
          title: { en: "Mains" },
          items: [liveBigNac, inactiveStagedBigNac, publicItems.find((i) => i.en === "Conchiglie")],
        },
      ],
      desserts: [
        {
          title: { en: "Desserts" },
          items: [publicItems.find((i) => i.en === "Brownies")],
        },
      ],
    });

    const daytimeNames = filtered.daytime[0].items.map((i) => i.en);
    expect(daytimeNames).toEqual(["Big NAC", "Conchiglie"]);
    expect(daytimeNames).not.toContain("Big NAC (staged archive)");
    expect(filtered.desserts[0].items[0].en).toBe("Brownies");
    expect(filtered.desserts[0].items[0].image).toContain("brownies.jpg");
  });

  test("breakfast contextual flow includes desserts for Brownies availability", () => {
    const flow = getContextualFlow(riyadhDate("Wed", 10, 0));
    expect(flow.primary).toBe("breakfast");
    expect(flow.categories).toEqual(
      expect.arrayContaining(["breakfast", "desserts", "drinks"]),
    );
    const tabs = getMenuLevelTabs("breakfast", false).map((t) => t.id);
    expect(tabs).toEqual(["breakfast", "drinks"]);
  });

  test("non-breakfast hosts include desserts tab for full six-item availability", () => {
    expect(getMenuLevelTabs("daytime", false).map((t) => t.id)).toEqual([
      "daytime",
      "desserts",
      "drinks",
    ]);
    expect(getMenuLevelTabs("evening", false).map((t) => t.id)).toEqual([
      "evening",
      "desserts",
      "drinks",
    ]);
  });

  test("release item image URLs stay on optimized seasonal-2026 public paths", () => {
    RELEASE_ITEMS.forEach((item) => {
      expect(item.image.startsWith(IMG_BASE)).toBe(true);
      expect(item.image).not.toMatch(/staged-unassigned/);
    });
  });
});
