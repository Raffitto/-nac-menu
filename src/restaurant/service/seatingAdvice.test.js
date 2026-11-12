import { recommendTables } from "./seatingAdvice";

test("recommendations use only open tables with a verified fit", () => {
  const tables = [
    { id: "khobar:12", label: "12", status: "open", capacity: "verified", minSeats: 2, maxSeats: 4, floorId: "indoor", active: true },
    { id: "khobar:14", label: "14", status: "open", capacity: "unverified", minSeats: null, maxSeats: null, floorId: "indoor", active: true },
    { id: "khobar:16", label: "16", status: "occupied", capacity: "verified", minSeats: 2, maxSeats: 4, floorId: "indoor", active: true },
    { id: "khobar:18", label: "18", status: "open", capacity: "verified", minSeats: 6, maxSeats: 8, floorId: "indoor", active: true },
  ];
  const advice = recommendTables({
    tables,
    reservations: [{ id: "r1", status: "booked", tableId: "khobar:20", time: "19:30" }],
    partySize: 2,
  });
  expect(advice.ok).toBe(true);
  expect(advice.recommendations.map((row) => row.label)).toEqual(["12"]);
  expect(advice.recommendations[0].because).toMatch(/verified for 2 to 4/);
  expect(advice.skippedUnverified).toBe(1);
  expect(advice.writes).toBe(0);
});

test("a missing party size does not invent a table", () => {
  const advice = recommendTables({ tables: [], partySize: 0 });
  expect(advice.ok).toBe(false);
  expect(advice.recommendations).toEqual([]);
});
