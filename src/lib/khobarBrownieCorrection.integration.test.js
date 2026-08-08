import fs from "fs";
import path from "path";
import { filterPublicMenuData } from "./menuVisibility";
import { getContextualFlow } from "./contextualMenu";
import { getMenuLevelTabs } from "./menuPresentation";

const correctionPath = path.resolve(
  __dirname,
  "../../supabase/migrations/20260808200000_correct_khobar_brownie_commercial_details.sql",
);
const releasePath = path.resolve(
  __dirname,
  "../../supabase/migrations/20260808190000_publish_khobar_seasonal_menu_selections.sql",
);
const correction = fs.readFileSync(correctionPath, "utf8");
const release = fs.readFileSync(releasePath, "utf8");

const BROWNIE_IMAGE =
  "https://zeyhvjuraqnlbdycgrme.supabase.co/storage/v1/object/public/menu-images/items/seasonal-2026/brownies.jpg";

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

describe("Khobar Brownie commercial correction migration", () => {
  test("corrects printed-menu name, price, and calories without rewriting allergens or image", () => {
    expect(correction).toContain("a6070000-0000-4000-8000-000000000006");
    expect(correction).toContain("Brownie, Caramel, Vanilla Ice Cream");
    expect(correction).toContain("'62 SAR'");
    expect(correction).toContain("'1070'");
    expect(correction).toContain("brownies.jpg");
    expect(correction).toContain("array['d', 'e', 'g']");
    expect(correction).toContain("refusing to rewrite");
    expect(correction).not.toContain("update public.item_allergens");
    expect(correction).not.toContain("delete from public.item_allergens");
  });

  test("is idempotent, publishes through the menu pipeline, and stays Brownie-scoped", () => {
    expect(correction).toContain("pg_advisory_xact_lock");
    expect(correction).toContain("publish_menu_branch");
    expect(correction).toContain("khobar-brownie-commercial-correction-2026-08-08");
    expect(correction).toContain("verify_menu_publication");
    expect(correction).toContain("placement_group_id = v_group_id");
    expect(correction).not.toMatch(/Watermelon|King Prawn|Conchiglie|Pan Seared|Big NAC|food_bible|inventory-cost/i);
    expect(correction).not.toContain("20260808190000");
  });

  test("does not rewrite the prior seasonal release migration in place", () => {
    expect(fs.existsSync(releasePath)).toBe(true);
    expect(release).toContain("'Brownies'");
    expect(release).toContain("v_cookies_calories");
    expect(correctionPath).not.toEqual(releasePath);
  });
});

describe("Corrected Brownie guest visibility", () => {
  const brownie = {
    id: "a6070000-0000-4000-8000-000000000006",
    en: "Brownie, Caramel, Vanilla Ice Cream",
    price: "62 SAR",
    calories: "1070",
    allergens: ["d", "e", "g"],
    image: BROWNIE_IMAGE,
    active: true,
  };

  test("public menu keeps corrected Brownie commercial fields and image", () => {
    const filtered = filterPublicMenuData({
      desserts: [{ title: { en: "Desserts" }, items: [brownie] }],
      breakfast: [{ title: { en: "Sweets" }, items: [brownie] }],
    });
    expect(filtered.desserts[0].items).toHaveLength(1);
    expect(filtered.desserts[0].items[0]).toMatchObject({
      en: "Brownie, Caramel, Vanilla Ice Cream",
      price: "62 SAR",
      calories: "1070",
      allergens: ["d", "e", "g"],
      image: BROWNIE_IMAGE,
    });
    expect(filtered.breakfast[0].items[0].en).toBe(
      "Brownie, Caramel, Vanilla Ice Cream",
    );
  });

  test("breakfast contextual flow still includes desserts for Brownie availability", () => {
    const flow = getContextualFlow(riyadhDate("Wed", 10, 0));
    expect(flow.primary).toBe("breakfast");
    expect(flow.categories).toEqual(
      expect.arrayContaining(["breakfast", "desserts", "drinks"]),
    );
    expect(getMenuLevelTabs("daytime", false).map((t) => t.id)).toContain(
      "desserts",
    );
  });
});
