/**
 * Khobar floor geometry reconstructed from the host's room reference.
 * This is the layout source for service tables. It is not a second table store.
 * Coordinates are percentages of the floor canvas. Seats are omitted on purpose:
 * the photographs do not show capacities.
 */
export const KHOBAR_ZONES = Object.freeze([
  { id: "outdoor", name: "Outdoor", points: "2,2 98,2 92,16 50,20 8,16" },
  { id: "waiting", name: "Waiting area", points: "2,22 30,22 30,38 2,38" },
  { id: "indoor", name: "Indoor", points: "2,40 80,40 80,98 2,98" },
  { id: "bar", name: "Bar", points: "34,70 54,70 54,84 34,84" },
  { id: "kitchen", name: "Kitchen", points: "4,86 34,86 34,97 4,97" },
]);

export const KHOBAR_TABLES = Object.freeze([
  { label: "50", zone: "outdoor", shape: "round", x: 10, y: 6 },
  { label: "51", zone: "outdoor", shape: "round", x: 20, y: 5 },
  { label: "52", zone: "outdoor", shape: "round", x: 31, y: 8 },
  { label: "53", zone: "outdoor", shape: "round", x: 42, y: 11 },
  { label: "54", zone: "outdoor", shape: "round", x: 52, y: 14 },
  { label: "55", zone: "outdoor", shape: "round", x: 60, y: 13 },
  { label: "56", zone: "outdoor", shape: "round", x: 68, y: 11 },
  { label: "57", zone: "outdoor", shape: "round", x: 76, y: 8 },
  { label: "58", zone: "outdoor", shape: "round", x: 84, y: 6 },
  { label: "59", zone: "outdoor", shape: "round", x: 93, y: 5 },
  { label: "30", zone: "outdoor", shape: "round", x: 36, y: 27 },
  { label: "31", zone: "outdoor", shape: "round", x: 46, y: 28 },
  { label: "35", zone: "outdoor", shape: "round", x: 34, y: 36 },
  { label: "34", zone: "outdoor", shape: "round", x: 44, y: 35 },
  { label: "33", zone: "outdoor", shape: "round", x: 54, y: 33 },
  { label: "32", zone: "outdoor", shape: "square", x: 66, y: 26 },
  { label: "40", zone: "outdoor", shape: "square", x: 76, y: 25 },
  { label: "41", zone: "outdoor", shape: "round", x: 86, y: 25 },
  { label: "42", zone: "outdoor", shape: "square", x: 90, y: 40 },
  { label: "15", zone: "indoor", shape: "round", x: 14, y: 46 },
  { label: "14", zone: "indoor", shape: "round", x: 12, y: 56 },
  { label: "16", zone: "indoor", shape: "round", x: 24, y: 56 },
  { label: "12", zone: "indoor", shape: "square", x: 12, y: 66 },
  { label: "18", zone: "indoor", shape: "round", x: 26, y: 66 },
  { label: "11", zone: "indoor", shape: "square", x: 12, y: 74 },
  { label: "17", zone: "indoor", shape: "round", x: 24, y: 74 },
  { label: "10", zone: "indoor", shape: "square", x: 12, y: 84 },
  { label: "20", zone: "indoor", shape: "square", x: 38, y: 52 },
  { label: "21", zone: "indoor", shape: "square", x: 46, y: 52 },
  { label: "22", zone: "indoor", shape: "square", x: 54, y: 52 },
  { label: "23", zone: "indoor", shape: "square", x: 62, y: 52 },
  { label: "24", zone: "indoor", shape: "square", x: 72, y: 52 },
  { label: "102", zone: "indoor", shape: "square", x: 34, y: 62 },
  { label: "101", zone: "indoor", shape: "square", x: 41, y: 62 },
  { label: "103", zone: "indoor", shape: "square", x: 48, y: 62 },
  { label: "104", zone: "indoor", shape: "square", x: 55, y: 62 },
  { label: "105", zone: "indoor", shape: "square", x: 62, y: 62 },
  { label: "25", zone: "indoor", shape: "square", x: 72, y: 64 },
  { label: "49", zone: "indoor", shape: "square", x: 84, y: 50 },
  { label: "48", zone: "indoor", shape: "square", x: 82, y: 66 },
  { label: "43", zone: "indoor", shape: "square", x: 90, y: 66 },
  { label: "26", zone: "indoor", shape: "square", x: 70, y: 76 },
  { label: "27", zone: "indoor", shape: "square", x: 70, y: 84 },
  { label: "47", zone: "indoor", shape: "square", x: 84, y: 82 },
  { label: "28", zone: "kitchen", shape: "square", x: 52, y: 90 },
  { label: "44", zone: "kitchen", shape: "square", x: 74, y: 94 },
  { label: "45", zone: "kitchen", shape: "square", x: 58, y: 96 },
]);

export const FLOOR_STORAGE_KEY = "nac-khobar-floor:v1";

export const BOOKING_WINDOWS = Object.freeze([
  { id: "morning", label: "Morning", start: "09:00", end: "12:00" },
  { id: "afternoon", label: "Afternoon", start: "12:00", end: "17:00" },
  { id: "evening", label: "Evening", start: "17:00", end: "23:30" },
]);

export function windowSlots(windowId) {
  const chosen = BOOKING_WINDOWS.find((row) => row.id === windowId) || BOOKING_WINDOWS[2];
  const [startH, startM] = chosen.start.split(":").map(Number);
  const [endH, endM] = chosen.end.split(":").map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  const slots = [];
  for (let minute = start; minute <= end; minute += 15) {
    const hours = Math.floor(minute / 60);
    const mins = minute % 60;
    slots.push(`${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
  }
  return slots;
}

export function clampZoom(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value)) return 1;
  return Math.min(2.4, Math.max(0.55, Math.round(value * 100) / 100));
}

export function loadFloorPositions(storage) {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(FLOOR_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveFloorPositions(storage, positions) {
  if (!storage) return;
  storage.setItem(FLOOR_STORAGE_KEY, JSON.stringify(positions));
}

export function placedTables(overrides = {}) {
  return KHOBAR_TABLES.map((table) => {
    const saved = overrides[table.label];
    if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
      return { ...table, x: Number(saved.x), y: Number(saved.y) };
    }
    return table;
  });
}
