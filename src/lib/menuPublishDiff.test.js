import { diffMenuSnapshots, itemPublishBadge, summarizeDiffForPublish } from "./menuPublishDiff";
import { snapshotToGuestMenu } from "./menuPublishSnapshots";

function snap(items, sections = [], categories = []) {
  return {
    branch_id: "khobar",
    categories,
    sections,
    menu_items: items,
    item_addons: [],
    item_allergens: [],
  };
}

describe("menuPublishDiff", () => {
  const categories = [{ id: "cat-1", name_en: "Evening", slug: "evening-menu", active: true, sort_order: 1 }];
  const sections = [
    { id: "sec-sides", name_en: "Sides", category_id: "cat-1", active: true, sort_order: 1 },
    { id: "sec-mains", name_en: "Mains", category_id: "cat-1", active: true, sort_order: 2 },
  ];

  test("unchanged items produce no badge", () => {
    const item = {
      id: "a",
      name_en: "Halloumi",
      price: 48,
      section_id: "sec-mains",
      category_id: "cat-1",
      active: true,
      sort_order: 1,
    };
    const diff = diffMenuSnapshots(snap([item], sections, categories), snap([item], sections, categories));
    expect(diff.hasChanges).toBe(false);
    expect(itemPublishBadge("a", diff)).toBeNull();
  });

  test("price change and move are human-readable", () => {
    const live = snap(
      [
        {
          id: "prawn",
          name_en: "King Prawn Rendang",
          price: 95,
          section_id: "sec-sides",
          category_id: "cat-1",
          active: true,
          sort_order: 1,
        },
      ],
      sections,
      categories,
    );
    const draft = snap(
      [
        {
          id: "prawn",
          name_en: "King Prawn Rendang",
          price: 99,
          section_id: "sec-mains",
          category_id: "cat-1",
          active: true,
          sort_order: 1,
        },
      ],
      sections,
      categories,
    );
    const diff = diffMenuSnapshots(live, draft);
    expect(diff.hasChanges).toBe(true);
    expect(itemPublishBadge("prawn", diff)?.label).toBe("Changed");
    const entry = diff.changes.find((c) => c.id === "prawn");
    expect(entry.summaryLines.some((l) => l.includes("Price: 95 SAR → 99 SAR"))).toBe(true);
    expect(entry.summaryLines.some((l) => l.includes("Sides → Mains"))).toBe(true);
  });

  test("new item badge", () => {
    const live = snap([], sections, categories);
    const draft = snap(
      [
        {
          id: "new-1",
          name_en: "Seasonal Special",
          price: 40,
          section_id: "sec-mains",
          category_id: "cat-1",
          active: true,
          sort_order: 1,
        },
      ],
      sections,
      categories,
    );
    const diff = diffMenuSnapshots(live, draft);
    expect(itemPublishBadge("new-1", diff)).toEqual({ key: "new", label: "New" });
    expect(summarizeDiffForPublish(diff).headline).toContain("1 change");
  });

  test("visibility change counted as availability", () => {
    const liveItem = {
      id: "b",
      name_en: "Brownie",
      price: 42,
      section_id: "sec-mains",
      category_id: "cat-1",
      active: true,
      sort_order: 1,
    };
    const draftItem = { ...liveItem, active: false };
    const diff = diffMenuSnapshots(
      snap([liveItem], sections, categories),
      snap([draftItem], sections, categories),
    );
    expect(diff.counts.availability).toBe(1);
  });

  test("reorder-only batches collapse into semantic summary", () => {
    const mk = (id, order) => ({
      id,
      name_en: id,
      price: 10,
      section_id: "sec-mains",
      category_id: "cat-1",
      active: true,
      sort_order: order,
    });
    const live = snap([mk("a", 1), mk("b", 2), mk("c", 3), mk("d", 4)], sections, categories);
    const draft = snap([mk("a", 4), mk("b", 3), mk("c", 2), mk("d", 1)], sections, categories);
    const diff = diffMenuSnapshots(live, draft);
    expect(diff.changes.some((c) => c.kind === "reorder_summary")).toBe(true);
    expect(JSON.stringify(diff.changes)).not.toMatch(/sort_order 1 → 4/);
  });

  test("snapshot preview is read-only transform and respects filter", () => {
    const guest = snapshotToGuestMenu(
      snap(
        [
          {
            id: "hidden",
            name_en: "Hidden Dish",
            price: 10,
            section_id: "sec-mains",
            category_id: "cat-1",
            active: false,
            sort_order: 1,
          },
          {
            id: "visible",
            name_en: "Visible Dish",
            price: 12,
            section_id: "sec-mains",
            category_id: "cat-1",
            active: true,
            sort_order: 2,
          },
        ],
        sections,
        categories,
      ),
    );
    const items = guest.menuData["evening-menu"]?.[0]?.items || [];
    expect(items.map((i) => i.id)).toEqual(["visible"]);
  });
});
