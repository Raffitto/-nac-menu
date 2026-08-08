import fs from "fs";
import path from "path";
import { filterPublicMenuData } from "./menuVisibility";
import { getContextualFlow } from "./contextualMenu";

const migrationPath = path.resolve(
  __dirname,
  "../../supabase/migrations/20260808203000_move_khobar_king_prawn_to_mains.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

const PRAWN_IMAGE =
  "https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/king-prawn-rendang.jpg";

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

describe("Khobar King Prawn Mains placement correction", () => {
  test("moves only King Prawn section placement to Mains/Plates", () => {
    expect(migration).toContain("a6070000-0000-4000-8000-000000000001");
    expect(migration).toContain("s.name_en = 'Mains'");
    expect(migration).toContain("s.name_en = 'Plates'");
    expect(migration).toContain("set section_id = v_target");
    expect(migration).toContain("King Prawn still appears under Sides");
    expect(migration).toContain("khobar-king-prawn-move-to-mains-2026-08-08");
  });

  test("preserves commercial fields, allergens, image, and Breakfast exclusion", () => {
    expect(migration).toContain("'62 SAR'");
    expect(migration).toContain("'472'");
    expect(migration).toContain("king-prawn-rendang.jpg");
    expect(migration).toContain("array['c', 'f', 'g', 'n', 's', 'se', 'sh', 'su']");
    expect(migration).toContain("must remain unavailable at Breakfast");
    expect(migration).not.toContain("update public.item_allergens");
    expect(migration).not.toContain("delete from public.item_allergens");
  });

  test("does not touch Brownie or other seasonal commercial data", () => {
    expect(migration).toContain("Brownie, Caramel, Vanilla Ice Cream");
    expect(migration).toContain("'1070'");
    expect(migration).not.toMatch(/Watermelon|Conchiglie|Pan Seared|Big NAC|food_bible|inventory-cost/i);
    expect(migration).not.toContain("20260808190000");
    expect(migration).not.toContain("20260808200000");
  });
});

describe("King Prawn guest visibility after Mains move", () => {
  const prawn = {
    id: "a6070000-0000-4000-8000-000000000001",
    en: "King Prawn Rendang",
    descEn: "Grilled lemon.",
    price: "62 SAR",
    calories: "472",
    allergens: ["c", "f", "g", "n", "s", "se", "sh", "su"],
    image: PRAWN_IMAGE,
    active: true,
  };

  test("public dinner/daytime hosts show prawn under Mains once and not under Sides", () => {
    const filtered = filterPublicMenuData({
      evening: [
        { title: { en: "Mains" }, items: [prawn] },
        { title: { en: "Sides" }, items: [] },
      ],
      breakfast: [
        { title: { en: "Plates" }, items: [] },
        { title: { en: "Sides" }, items: [] },
      ],
    });
    expect(filtered.evening).toHaveLength(1);
    expect(filtered.evening[0].title.en).toBe("Mains");
    expect(filtered.evening[0].items).toHaveLength(1);
    expect(filtered.evening[0].items[0]).toMatchObject({
      en: "King Prawn Rendang",
      price: "62 SAR",
      calories: "472",
      image: PRAWN_IMAGE,
    });
    expect(filtered.breakfast || []).toEqual([]);
  });

  test("breakfast contextual flow remains free of prawn food host requirement", () => {
    const flow = getContextualFlow(riyadhDate("Wed", 10, 0));
    expect(flow.primary).toBe("breakfast");
    expect(flow.categories).not.toContain("evening");
    expect(flow.categories).not.toContain("daytime");
  });
});
