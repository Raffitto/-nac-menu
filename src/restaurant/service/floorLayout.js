/**
 * Khobar reference furniture positions. These are screen coordinates for the
 * dining room and terrace. They are not service rows and they do not move a session.
 */
export const KHOBAR_FLOOR_REFERENCE = Object.freeze({
  branchId: "khobar",
  rooms: Object.freeze({
    main: { name: "Dining room", landmarks: ["Host stand", "Pass window"] },
    terrace: { name: "Terrace", landmarks: ["Terrace door"] },
  }),
  positions: Object.freeze({
    t1: { x: 28, y: 32 },
    t2: { x: 70, y: 74 },
    t3: { x: 46, y: 58 },
  }),
});

export function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.min(88, Math.max(12, Math.round(number)));
}

export function nudgePosition(position, key) {
  const step = 4;
  const current = position || { x: 50, y: 50 };
  if (key === "ArrowLeft") return { x: clampPercent(current.x - step), y: current.y };
  if (key === "ArrowRight") return { x: clampPercent(current.x + step), y: current.y };
  if (key === "ArrowUp") return { x: current.x, y: clampPercent(current.y - step) };
  if (key === "ArrowDown") return { x: current.x, y: clampPercent(current.y + step) };
  return null;
}

export function resolvePositions(tables, overrides = {}) {
  const resolved = {};
  (tables || []).forEach((table, index) => {
    const saved = overrides[table.id];
    const reference = KHOBAR_FLOOR_REFERENCE.positions[table.id];
    if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) {
      resolved[table.id] = { x: clampPercent(saved.x), y: clampPercent(saved.y) };
    } else if (reference) {
      resolved[table.id] = { x: reference.x, y: reference.y };
    } else {
      resolved[table.id] = {
        x: clampPercent(22 + (index % 3) * 24),
        y: clampPercent(32 + Math.floor(index / 3) * 22),
      };
    }
  });
  return resolved;
}

function seatLimit(table) {
  if (!table || table.capacity === "unverified") return null;
  if (table.capacity === "verified") {
    return Number.isInteger(table.maxSeats) ? table.maxSeats : null;
  }
  return Number.isFinite(table.seats) ? table.seats : null;
}

export function suggestTable(tables, partySize) {
  const party = Number(partySize);
  const open = (tables || []).filter((table) => table.status === "open" && table.active !== false && !table.removed);
  const fitting = open.filter((table) => {
    const seats = seatLimit(table);
    return seats != null && Number.isFinite(party) && seats >= party;
  });
  fitting.sort((a, b) => seatLimit(a) - seatLimit(b));
  return fitting[0] || null;
}

export function serviceDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function shiftServiceDate(value, days) {
  const next = new Date(`${value}T12:00:00`);
  if (Number.isNaN(next.getTime())) return value;
  next.setDate(next.getDate() + days);
  return serviceDateValue(next);
}
