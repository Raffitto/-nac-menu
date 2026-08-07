import fs from "fs";
import path from "path";
import { filterPublicMenuData } from "./menuVisibility";

const migrationPath = path.resolve(
  __dirname,
  "../../supabase/migrations/20260807160000_stage_riyadh_seasonal_selections.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const itemInsert = migration.match(
  /insert into public\.menu_items \([\s\S]*?\n  on conflict \(id\) do nothing;/i,
)?.[0] || "";

const expectedItems = [
  {
    id: "a6070000-0000-4000-8000-000000000001",
    slug: "seasonal-2026-king-prawn-rendang",
    en: "King Prawn Rendang",
    ar: "روبيان الملك برندانغ",
    descEn: "Grilled lemon.",
    descAr: "ليمون مشوي",
    calories: "472",
    price: "62",
    allergens: ["s", "sh", "se", "su", "f", "n", "c", "g"],
    image: "king-prawn-rendang.jpg",
  },
  {
    id: "a6070000-0000-4000-8000-000000000002",
    slug: "seasonal-2026-watermelon-cucumber",
    en: "Watermelon & Cucumber",
    ar: "بطيخ وخيار",
    descEn: "Feta, pine nuts, balsamic dressing.",
    descAr: "جبنة فيتا، صنوبر، صوص بلسميك",
    calories: "341",
    price: "59",
    allergens: ["m", "su", "n"],
    image: "watermelon-cucumber.jpg",
  },
  {
    id: "a6070000-0000-4000-8000-000000000003",
    slug: "seasonal-2026-conchiglie",
    en: "Conchiglie",
    ar: "مكرونة كونكيليه",
    descEn: "Wild morels, parmesan cream.",
    descAr: "فطر الموريل البري، كريمة البارميزان",
    calories: "800",
    price: "79",
    allergens: ["d", "g"],
    image: "conchiglie-wild-morels.jpg",
  },
  {
    id: "a6070000-0000-4000-8000-000000000004",
    slug: "seasonal-2026-big-nac-replacement",
    en: "Big NAC",
    ar: "بيغ نك",
    descEn: "",
    descAr: "",
    calories: "1115",
    price: "69",
    allergens: ["g", "d", "e", "m", "su", "se"],
    image: "big-nac.jpg",
  },
  {
    id: "a6070000-0000-4000-8000-000000000005",
    slug: "seasonal-2026-pan-seared-seabass",
    en: "Pan Seared Seabass",
    ar: "سمك سي باس مشوي",
    descEn: "Creole with pepper cream sauce, watercress.",
    descAr: "صوص كريول بكريمة الفلفل، جرجير",
    calories: "430",
    price: "72",
    allergens: ["c", "su", "d", "g", "m", "f"],
    image: "pan-seared-seabass.jpg",
  },
];

describe("Riyadh Seasonal Selections staging migration", () => {
  test("contains exactly five deterministic inactive, unplaced catalogue rows", () => {
    const insertedIds = [
      ...itemInsert.matchAll(
        /'((?:a6070000)-0000-4000-8000-00000000000[1-5])', null,/g,
      ),
    ].map((match) => match[1]);

    expect(insertedIds).toEqual(expectedItems.map((item) => item.id));
    expect(itemInsert.match(/false, false, false, false, false, false, null, 0, null, v_branch/g))
      .toHaveLength(5);
    expect(migration).toContain("alter column section_id drop not null");
    expect(migration).toContain("v_branch constant text := 'riyadh'");
  });

  test("preserves canonical EN/AR, prices, calories, images, and allergens", () => {
    expectedItems.forEach((item) => {
      expect(itemInsert).toContain(`'${item.slug}'`);
      expect(itemInsert).toContain(`'${item.en}', '${item.ar}'`);
      expect(itemInsert).toContain(`'${item.descEn}', '${item.descAr}'`);
      expect(itemInsert).toContain(`'${item.calories}', '${item.price}'`);
      expect(itemInsert).toContain(item.image);
      expect(migration).toContain(`array[${item.allergens.map((code) => `'${code}'`).join(",")}]`);
    });
    expect(migration).toContain("values ('c', 'Celery', 'كرفس')");
  });

  test("is rerun-safe and never publishes or mutates the existing live Big Nac", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("on conflict (id) do nothing");
    expect(migration).toContain("on conflict (item_id, allergen_id) do nothing");
    expect(migration).not.toMatch(/update\s+public\.menu_items/i);
    expect(migration).not.toContain("publish_menu_branch");
  });

  test("inactive staged items stay out of the guest menu until activated", () => {
    const staged = expectedItems.map((item) => ({
      id: item.id,
      slug: item.slug,
      en: item.en,
      ar: item.ar,
      descEn: item.descEn,
      descAr: item.descAr,
      price: item.price,
      calories: item.calories,
      allergens: item.allergens,
      image: item.image,
      active: false,
    }));
    const hidden = filterPublicMenuData({
      evening: [{ title: { en: "Mains" }, items: staged }],
    });
    expect(hidden.evening).toEqual([]);

    const activated = filterPublicMenuData({
      evening: [{
        title: { en: "Mains" },
        items: [{ ...staged[0], active: true }],
      }],
    });
    expect(activated.evening[0].items[0]).toMatchObject(expectedItems[0]);
  });

  test("does not invent a dessert menu item", () => {
    expect(itemInsert).not.toMatch(/dessert|ice cream|caramel/i);
  });
});
