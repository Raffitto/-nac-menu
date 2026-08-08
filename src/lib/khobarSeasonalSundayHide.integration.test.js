import fs from "fs";
import path from "path";
import { filterPublicMenuData, isPublicMenuItem } from "./menuVisibility";

const migrationPath = path.resolve(
  __dirname,
  "../../supabase/migrations/20260808210000_hide_khobar_seasonal_until_sunday.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

const ACTIVATE_AT = new Date("2026-08-09T00:00:00+03:00").getTime();
const SATURDAY_NIGHT = new Date("2026-08-08T20:45:00+03:00").getTime();
const SUNDAY_MORNING = new Date("2026-08-09T00:05:00+03:00").getTime();

describe("Khobar seasonal hide until Sunday activation", () => {
  test("uses native hidden_until Sunday 00:00 Asia/Riyadh without deactivating", () => {
    expect(migration).toContain("timestamptz '2026-08-09 00:00:00+03'");
    expect(migration).toContain("hidden_until = v_activate_at");
    expect(migration).toContain("active = true");
    expect(migration).toContain("khobar-seasonal-hide-until-sunday-2026-08-09");
    expect(migration).toContain("991c66b8-7f5d-4617-af87-b65bd114d58b");
    expect(migration).toContain("56d3a913-fa06-4130-aa40-273af09a29e1");
    expect(migration).toContain("e14ea002-2f20-4cb4-9d41-52ec13630e33");
    expect(migration).toContain("ad6e4f58-8844-4a06-852c-d60674d22fca");
    expect(migration).toContain("e494ed53-3d2f-4f74-b773-3b56c2886f9f");
    expect(migration).toContain("1a70a107-954d-4975-b1f9-5da7fd87f231");
  });

  test("preserves placements and Brownie commercial guards", () => {
    expect(migration).toContain("King Prawn Rendang");
    expect(migration).toContain("section_name = 'Mains'");
    expect(migration).toContain("section_name = 'Plates'");
    expect(migration).toContain("'62 SAR'");
    expect(migration).toContain("'1070'");
    expect(migration).not.toContain("update public.item_allergens");
    expect(migration).not.toContain("set section_id");
    expect(migration).not.toContain("set name_en");
    expect(migration).not.toContain("set price");
    expect(migration).not.toContain("set calories");
    expect(migration).not.toContain("set image");
  });

  test("guest filter hides items before Sunday and shows them after", () => {
    const item = {
      active: true,
      name_en: "King Prawn Rendang",
      hidden_until: "2026-08-09T00:00:00+03:00",
    };
    expect(isPublicMenuItem(item, SATURDAY_NIGHT)).toBe(false);
    expect(isPublicMenuItem(item, ACTIVATE_AT)).toBe(true);
    expect(isPublicMenuItem(item, SUNDAY_MORNING)).toBe(true);

    const menu = filterPublicMenuData(
      {
        evening: [
          {
            id: "mains",
            items: [item, { active: true, name_en: "Frites", hidden_until: null }],
          },
        ],
      },
      SATURDAY_NIGHT,
    );
    expect(menu.evening[0].items.map((x) => x.name_en)).toEqual(["Frites"]);
  });
});
