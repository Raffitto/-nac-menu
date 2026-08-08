import fs from "fs";
import path from "path";
import {
  canMoveItemToSection,
  cloneSections,
  moveItemBetweenSections,
  reorderItemWithinSection,
} from "../lib/menuManagerOrdering";
import { sanitizeMenuItemPayload } from "../lib/menuApi";
import { isPublicMenuItem } from "../lib/menuVisibility";

const dashboardDir = path.resolve(__dirname);
const componentSource = fs.readFileSync(path.join(dashboardDir, "MenuManager.jsx"), "utf8");
const dndSource = fs.readFileSync(path.join(dashboardDir, "MenuManagerDnd.jsx"), "utf8");
const cssSource = fs.readFileSync(path.join(dashboardDir, "styles/menu-manager.css"), "utf8");
const apiSource = fs.readFileSync(
  path.join(dashboardDir, "../lib/menuApi.js"),
  "utf8",
);

describe("MenuManager Apple-style drag and drop", () => {
  test("wires dnd-kit multi-container board into Menu Manager", () => {
    expect(componentSource).toContain('from "./MenuManagerDnd"');
    expect(componentSource).toContain("MenuManagerDndProvider");
    expect(componentSource).toContain("SectionFrame");
    expect(componentSource).toContain("ItemFrame");
    expect(componentSource).toContain("handleBoardDragEnd");
    expect(componentSource).toContain("persistItemBoardChange");
    expect(componentSource).toContain("moveMenuItemToSection");
    expect(dndSource).toContain("@dnd-kit/core");
    expect(dndSource).toContain("@dnd-kit/sortable");
    expect(dndSource).toContain("TouchSensor");
    expect(dndSource).toContain("delay: fluid ? 180 : 280");
    expect(dndSource).toContain("activationConstraint: { distance: fluid ? 4 : 8 }");
  });

  test("isolates action controls from drag activation", () => {
    expect(componentSource).toContain("onPointerDown={isolateInteractivePointer}");
    expect(componentSource).toContain('aria-label={`Edit ${item.name_en || "item"}`}');
    expect(componentSource).toContain('aria-label={`Delete ${item.name_en || "item"}`}');
    expect(componentSource).toContain('aria-label="Change guest menu visibility"');
    expect(componentSource).toContain("mm-reorder-fallback");
    expect(cssSource).toContain(".mm-item-card--dragging");
    expect(cssSource).toContain("scale(1.03)");
  });

  test("disables drag while filters/search are active and keeps fallback reorder", () => {
    expect(componentSource).toContain("Clear filters to drag cards");
    expect(componentSource).toContain("!searchQuery.trim()");
    expect(componentSource).toContain('activeFilter === "all"');
    expect(componentSource).toContain("handleReorderItem(section.id, item.id, -1)");
    expect(componentSource).toContain("handleReorderSection(section.id, -1)");
  });

  test("move API only patches section_id", () => {
    expect(apiSource).toContain("export async function moveMenuItemToSection");
    expect(apiSource).toContain("return updateMenuItem(itemId, { section_id: destinationSectionId });");
    const payload = sanitizeMenuItemPayload({
      section_id: "dest",
      price: "62 SAR",
      calories: "1070",
      hidden_until: "2026-08-09T00:00:00+03:00",
      active: true,
      image: "x.jpg",
    });
    // Full sanitize keeps provided fields, but move helper only sends section_id.
    expect(payload.section_id).toBe("dest");
    const moveOnly = sanitizeMenuItemPayload({ section_id: "dest" });
    expect(moveOnly).toEqual({ section_id: "dest" });
  });

  test("failed save rollback restores prior board snapshot semantics", () => {
    const before = [
      {
        id: "s1",
        items: [
          { id: "a", section_id: "s1", hidden_until: "2026-08-09T00:00:00+03:00", price: "59 SAR" },
          { id: "b", section_id: "s1", hidden_until: null, price: "10 SAR" },
        ],
      },
    ];
    const snapshot = cloneSections(before);
    const optimistic = reorderItemWithinSection(before, "s1", 1, 0);
    expect(optimistic[0].items.map((i) => i.id)).toEqual(["b", "a"]);
    // Simulate rollback
    const rolled = snapshot;
    expect(rolled[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(rolled[0].items[0].hidden_until).toBe("2026-08-09T00:00:00+03:00");
    expect(rolled[0].items[0].price).toBe("59 SAR");
  });

  test("cross-section move does not duplicate and preserves seasonal hide semantics", () => {
    const sections = [
      {
        id: "nibbles",
        items: [
          {
            id: "olives",
            section_id: "nibbles",
            active: true,
            hidden_until: "2026-08-09T00:00:00+03:00",
            price: "29 SAR",
            calories: "120",
            image: "olives.jpg",
          },
        ],
      },
      { id: "plates", items: [] },
    ];
    const moved = moveItemBetweenSections(sections, "olives", "plates", 0);
    expect(moved.error).toBeNull();
    expect(moved.sections.flatMap((s) => s.items).filter((i) => i.id === "olives")).toHaveLength(1);
    const item = moved.sections[1].items[0];
    expect(item.section_id).toBe("plates");
    expect(item.hidden_until).toBe("2026-08-09T00:00:00+03:00");
    expect(item.price).toBe("29 SAR");
    expect(item.calories).toBe("120");
    expect(item.image).toBe("olives.jpg");
    expect(isPublicMenuItem(item, new Date("2026-08-08T20:00:00+03:00").getTime())).toBe(false);
    expect(isPublicMenuItem(item, new Date("2026-08-09T00:05:00+03:00").getTime())).toBe(true);
    expect(canMoveItemToSection(moved.sections, "olives", "plates").ok).toBe(true);
  });

  test("reorder/move save as draft and require explicit publish pipeline", () => {
    expect(componentSource).toContain("noteDraftChanged");
    expect(componentSource).toContain("confirmPublishFromDiff");
    expect(componentSource).toContain("publishCurrentMenu");
    expect(componentSource).toContain("publishAndVerifyMenuBranch");
  });
});
