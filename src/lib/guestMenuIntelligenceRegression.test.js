import fs from "fs";
import path from "path";
import { customizationDisplaySrc } from "./menuImageSources";

const root = path.join(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("guest menu intelligence regression", () => {
  const migration = read("supabase/migrations/20261015160000_menu_event_detail_rollup.sql");
  const app = read("src/App.js");

  function sliceBetween(source, start, end) {
    const from = source.indexOf(start);
    const to = end ? source.indexOf(end, from + start.length) : source.length;
    return source.slice(from, to === -1 ? source.length : to);
  }

  test("rollup readers take rankings from the detail summary, not empty arrays", () => {
    const bi = sliceBetween(
      migration,
      "function public.get_bi_dashboard_from_rollup",
      "function public.get_session_analytics_from_rollup",
    );
    const session = sliceBetween(
      migration,
      "function public.get_session_analytics_from_rollup",
      "function public.refresh_menu_events_daily_rollup_intraday",
    );
    expect(bi).toContain("menu_event_detail_summary");
    expect(session).toContain("menu_event_detail_summary");
    expect(bi).not.toContain("'top_items', '[]'::jsonb");
    expect(bi).toContain("payload->'top_items'");
    expect(session.indexOf("payload->'top_items'")).toBeGreaterThan(session.indexOf("menu_event_detail_summary"));
  });

  test("detail refresh is a created_at index range, and dashboard SQL does not scan menu_events", () => {
    const refresh = sliceBetween(
      migration,
      "function public.refresh_menu_events_detail_daily",
      "function public.menu_event_detail_summary",
    );
    const bi = sliceBetween(
      migration,
      "function public.get_bi_dashboard_from_rollup",
      "function public.get_session_analytics_from_rollup",
    );
    expect(refresh).toContain("m.created_at >=");
    expect(refresh).toContain("m.created_at <");
    expect(bi).not.toMatch(/from public\.menu_events\s+m\b/);
    expect(bi).toContain("from public.menu_events_daily_rollup");
    expect(migration).toContain("idx_menu_events_created_at_desc");
    expect(read("src/lib/intelligenceQueryApi.js")).toContain("const useRollup = true");
  });

  test("one add-on click records one add_on_click", () => {
    expect(app).not.toContain("trackAddOnOpen");
    expect(app.match(/event_type: "add_on_click"/g)).toHaveLength(1);
  });

  test("customization WebP is used only where a same-size variant already exists", () => {
    expect(customizationDisplaySrc("/rigatoni-pink-sauce-chicken.jpg")).toMatchObject({
      display: "/rigatoni-pink-sauce-chicken-1400.webp",
      fallback: "/rigatoni-pink-sauce-chicken.jpg",
      usesVariant: true,
    });
    expect(customizationDisplaySrc("/rigatoni-pink-sauce-prawn.jpg").display)
      .toBe("/rigatoni-pink-sauce-prawn-1400.webp");
    expect(customizationDisplaySrc("/truffle-risotto-chicken.jpg").display)
      .toBe("/truffle-risotto-chicken-1400.webp");
    expect(customizationDisplaySrc("/truffle-risotto-prawn.jpg").display)
      .toBe("/truffle-risotto-prawn-1400.webp");
    expect(customizationDisplaySrc("/rigatoni-pink-sauce.jpg")).toMatchObject({
      display: "/rigatoni-pink-sauce.jpg",
      fallback: "/rigatoni-pink-sauce.jpg",
      usesVariant: false,
    });
    expect(customizationDisplaySrc("/truffle-risotto.jpg").usesVariant).toBe(false);
    expect(app).toContain("customizationDisplaySrc");
  });
});
