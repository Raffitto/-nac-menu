import { KHOBAR_TABLES, KHOBAR_ZONES, clampZoom, windowSlots } from "../layouts/khobarFloor";

test("the Khobar map includes the photographed tables and does not invent seats", () => {
  const labels = KHOBAR_TABLES.map((table) => table.label);
  ["10", "12", "14", "22", "28", "45", "50", "59", "101", "105"].forEach((label) => {
    expect(labels).toContain(label);
  });
  expect(new Set(labels).size).toBe(labels.length);
  expect(KHOBAR_TABLES.every((table) => table.seats == null)).toBe(true);
  expect(KHOBAR_ZONES.map((zone) => zone.name)).toEqual(
    expect.arrayContaining(["Outdoor", "Waiting area", "Indoor", "Bar", "Kitchen"]),
  );
  expect(windowSlots("morning")).toContain("09:30");
  expect(windowSlots("evening")).toContain("19:30");
  expect(clampZoom(9)).toBe(2.4);
});
