import {
  clearSelection,
  ensureSelectionIncludes,
  flattenVisibleItems,
  selectAllVisible,
  selectRange,
  selectSingle,
  toggleSelect,
} from "./selectionModel";
import { moveSelectedGroup, shouldConfirmBulk } from "./groupOrdering";
import { createUndoStack, pushCommand, redoCommand, undoCommand } from "./undoStack";

const sections = [
  {
    id: "s1",
    items: [
      { id: "a", section_id: "s1" },
      { id: "b", section_id: "s1" },
      { id: "c", section_id: "s1" },
      { id: "d", section_id: "s1" },
      { id: "e", section_id: "s1" },
    ],
  },
  {
    id: "s2",
    items: [{ id: "f", section_id: "s2" }],
  },
];

describe("menuInteraction selection model", () => {
  test("normal click selects one item", () => {
    expect(selectSingle({}, "b")).toEqual({
      selectedIds: ["b"],
      anchorId: "b",
      focusId: "b",
    });
  });

  test("toggle additive select/deselect", () => {
    const one = selectSingle({}, "a");
    const two = toggleSelect(one, "c");
    expect(two.selectedIds).toEqual(["a", "c"]);
    const back = toggleSelect(two, "a");
    expect(back.selectedIds).toEqual(["c"]);
  });

  test("shift range stays inside section", () => {
    const anchor = selectSingle({}, "b");
    const range = selectRange(anchor, sections, "e");
    expect(range.selectedIds).toEqual(["b", "c", "d", "e"]);

    const cross = selectRange(anchor, sections, "f");
    expect(cross.selectedIds).toEqual(["f"]);
  });

  test("select all / clear / ensure selection", () => {
    const all = selectAllVisible(sections);
    expect(all.selectedIds).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(clearSelection().selectedIds).toEqual([]);
    expect(ensureSelectionIncludes(all, "c").focusId).toBe("c");
    expect(ensureSelectionIncludes(clearSelection(), "c").selectedIds).toEqual(["c"]);
  });

  test("flatten respects visual order", () => {
    expect(flattenVisibleItems(sections).map((r) => r.itemId)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });
});

describe("menuInteraction group ordering", () => {
  test("moves selected group as a block preserving relative order", () => {
    const result = moveSelectedGroup(sections, ["b", "d"], "s2", 0);
    expect(result.error).toBeNull();
    expect(result.sections[0].items.map((i) => i.id)).toEqual(["a", "c", "e"]);
    expect(result.sections[1].items.map((i) => i.id)).toEqual(["b", "d", "f"]);
    expect(result.sections[1].items[0].section_id).toBe("s2");
  });

  test("rejects group move when any member conflicts", () => {
    const conflicted = [
      {
        id: "s1",
        items: [{ id: "a", section_id: "s1", placement_group_id: "pg" }],
      },
      {
        id: "s2",
        items: [{ id: "x", section_id: "s2", placement_group_id: "pg" }],
      },
    ];
    const result = moveSelectedGroup(conflicted, ["a"], "s2", 0);
    expect(result.error).toMatch(/linked placement/i);
  });

  test("bulk confirm thresholds", () => {
    expect(shouldConfirmBulk("hide", 19)).toBe(false);
    expect(shouldConfirmBulk("hide", 20)).toBe(true);
    expect(shouldConfirmBulk("delete", 1)).toBe(true);
  });
});

describe("menuInteraction undo stack", () => {
  test("undo/redo only after successful push", async () => {
    let value = 0;
    let stack = createUndoStack();
    stack = pushCommand(stack, {
      label: "inc",
      undo: async () => {
        value -= 1;
      },
      redo: async () => {
        value += 1;
      },
    });
    value = 1;
    const undone = await undoCommand(stack);
    expect(value).toBe(0);
    const redone = await redoCommand(undone.stack);
    expect(value).toBe(1);
    expect(redone.command.label).toBe("inc");
  });
});
