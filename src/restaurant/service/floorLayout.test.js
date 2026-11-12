import { clampPercent, nudgePosition, resolvePositions, shiftServiceDate, suggestTable } from "./floorLayout";

test("Khobar reference places dining-room table 12 and terrace table 1", () => {
  const placed = resolvePositions([
    { id: "t1", seats: 2 },
    { id: "t2", seats: 4 },
    { id: "t3", seats: 2 },
  ]);
  expect(placed.t1).toEqual({ x: 28, y: 32 });
  expect(placed.t3.x).toBeGreaterThan(12);
  expect(resolvePositions([{ id: "t1" }], { t1: { x: 99, y: -4 } }).t1).toEqual({ x: 88, y: 12 });
});

test("arrow keys nudge a table inside the room", () => {
  expect(nudgePosition({ x: 30, y: 40 }, "ArrowRight")).toEqual({ x: 34, y: 40 });
  expect(nudgePosition({ x: 12, y: 40 }, "ArrowLeft").x).toBe(12);
  expect(clampPercent("nope")).toBe(50);
});

test("a party of three is offered the four-seat table", () => {
  const tables = [
    { id: "t1", label: "12", seats: 2, status: "open" },
    { id: "t2", label: "14", seats: 4, status: "open" },
    { id: "t3", label: "1", seats: 2, status: "open" },
  ];
  expect(suggestTable(tables, 2).id).toBe("t1");
  expect(suggestTable(tables, 3).id).toBe("t2");
  expect(shiftServiceDate("2026-11-08", 1)).toBe("2026-11-09");
});
