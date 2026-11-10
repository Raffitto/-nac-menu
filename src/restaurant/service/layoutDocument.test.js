import {
  activeLayout,
  addCombination,
  addArea,
  addTable,
  canonicalLayoutId,
  commitHistory,
  createHistory,
  defaultLayoutDocument,
  duplicateLayout,
  duplicateTable,
  editTable,
  loadLayoutDocument,
  publishLayout,
  redoHistory,
  restoreLayoutVersion,
  serviceLock,
  undoHistory,
} from "./layoutDocument";

test("the default Khobar layout uses service ids and does not invent seats", () => {
  const document = defaultLayoutDocument();
  const layout = activeLayout(document);
  expect(layout.tables).toHaveLength(47);
  expect(layout.tables.find((table) => table.label === "22")).toMatchObject({ id: "khobar:22" });
  expect(layout.tables.find((table) => table.label === "12").id).toBe("khobar:12");
  expect(layout.tables.every((table) => table.minSeats == null && table.maxSeats == null)).toBe(true);
});

test("a saved layout joins service ids and drops stored seat counts", () => {
  const storage = {
    value: JSON.stringify({
      seq: 1,
      activeId: "weekday",
      layouts: [{
        id: "weekday",
        name: "Weekday",
        period: "all",
        tables: [{ id: "khobar-12", label: "12", minSeats: 1, maxSeats: 2, x: 18, y: 20, shape: "square", zone: "indoor", active: true }],
        walls: [],
        elements: [],
        combinations: [],
      }],
      audit: [],
    }),
    getItem() { return this.value; },
  };
  const loaded = loadLayoutDocument(storage);
  const table = activeLayout(loaded).tables[0];
  expect(table.id).toBe("khobar:12");
  expect(table.x).toBe(18);
  expect(table.minSeats).toBeUndefined();
  expect(canonicalLayoutId({ id: "layout-4", label: "9" })).toBe("layout-4");
});

test("a service table keeps its number and a busy table cannot be removed", () => {
  const document = defaultLayoutDocument();
  const table = activeLayout(document).tables.find((row) => row.label === "12");
  const blocked = editTable(document, "weekday", table.id, { label: "12A" }, { tables: [] });
  expect(blocked.reason).toBe("table_identity_locked");
  const added = addTable(document, "weekday");
  const renamed = editTable(added.document, "weekday", added.table.id, { label: "Window" }, { tables: [] });
  expect(activeLayout(renamed.document).tables.find((row) => row.id === added.table.id).label).toBe("Window");
  const locked = editTable(document, "weekday", table.id, { deleted: true }, {
    tables: [{ label: "12", status: "occupied", sessionId: "session-1" }],
  });
  expect(locked.ok).toBe(false);
  expect(locked.reason).toBe("table_in_service");
  expect(serviceLock({ tables: [{ label: "14", status: "assigned", sessionId: null }] }, "14")).toBe("assigned");
});

test("undo restores a new table and combinations stay on the layout", () => {
  const start = createHistory(defaultLayoutDocument());
  const added = addTable(start.present, "weekday");
  const history = commitHistory(start, added.document);
  expect(activeLayout(history.present).tables).toHaveLength(48);
  const undone = undoHistory(history);
  expect(activeLayout(undone.present).tables).toHaveLength(47);
  const redone = redoHistory(undone);
  expect(activeLayout(redone.present).tables).toHaveLength(48);
  const combo = addCombination(redone.present, "weekday", ["khobar:12", "khobar:14"], "Window pair");
  expect(combo.ok).toBe(true);
  expect(activeLayout(combo.document).combinations[0].tableIds).toEqual(["khobar:12", "khobar:14"]);
  const copy = duplicateLayout(combo.document, "weekday", "Friday");
  expect(copy.document.activeId).not.toBe("weekday");
  expect(activeLayout(copy.document).tables.find((table) => table.label === "12").id).toBe("khobar:12");
});

test("publishing a layout keeps table identity and a locked table cannot move", () => {
  const document = defaultLayoutDocument();
  const table = activeLayout(document).tables.find((row) => row.label === "22");
  const published = publishLayout(document, "weekday");
  expect(published.ok).toBe(true);
  expect(published.version.snapshot.tables.find((row) => row.label === "22").id).toBe("khobar:22");
  const moved = editTable(published.document, "weekday", table.id, { x: table.x + 6 }, { tables: [] });
  const again = publishLayout(moved.document, "weekday");
  const restored = restoreLayoutVersion(again.document, published.version.id);
  expect(activeLayout(restored.document).tables.find((row) => row.id === "khobar:22").x).toBe(table.x);
  const locked = editTable(document, "weekday", table.id, { locked: true }, { tables: [] });
  const blocked = editTable(locked.document, "weekday", table.id, { x: 10 }, { tables: [] });
  expect(blocked.reason).toBe("table_locked");
  const copy = duplicateTable(document, "weekday", table.id);
  expect(copy.table.id).toMatch(/^layout-/);
  expect(copy.table.id).not.toBe(table.id);
});

test("an area can be added and a reserved table cannot be renumbered", () => {
  const document = defaultLayoutDocument();
  const added = addArea(document, "weekday", "Kitchen");
  expect(added.ok).toBe(true);
  expect(activeLayout(added.document).areas[0]).toMatchObject({ label: "Kitchen" });
  const addedTable = addTable(document, "weekday");
  const blocked = editTable(addedTable.document, "weekday", addedTable.table.id, { label: "99" }, {
    tables: [{ id: addedTable.table.id, label: addedTable.table.label }],
    reservations: [{ tableId: addedTable.table.id, status: "booked" }],
  });
  expect(blocked.reason).toBe("table_in_service");
});
