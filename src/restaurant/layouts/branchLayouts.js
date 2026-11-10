/**
 * Branch floor layouts. Service rows are created from these definitions
 * inside createRestaurant. Do not keep a second operational table list.
 */
import { KHOBAR_TABLES, KHOBAR_ZONES } from "./khobarFloor";

export function serviceTableId(branchId, label) {
  return `${branchId}:${label}`;
}

function unverifiedTable(branchId, floorId, label, id = serviceTableId(branchId, label)) {
  return {
    id,
    branchId,
    floorId,
    label,
    seats: null,
    minSeats: null,
    maxSeats: null,
    capacity: "unverified",
    active: true,
  };
}

export function khobarLayout(branchId = "khobar") {
  const seen = new Set();
  const tables = [];
  KHOBAR_TABLES.forEach((table) => {
    if (!table.label || seen.has(table.label)) return;
    seen.add(table.label);
    tables.push({
      ...unverifiedTable(branchId, table.zone, table.label),
      shape: table.shape,
      x: table.x,
      y: table.y,
    });
  });
  return {
    floors: KHOBAR_ZONES.map((zone) => ({ id: zone.id, branchId, name: zone.name })),
    tables,
  };
}

export function developmentLayout(branchId) {
  return {
    floors: [
      { id: "main", branchId, name: "Dining room" },
      { id: "terrace", branchId, name: "Terrace" },
    ],
    tables: [
      unverifiedTable(branchId, "main", "12", "t1"),
      unverifiedTable(branchId, "main", "14", "t2"),
      unverifiedTable(branchId, "terrace", "1", "t3"),
    ],
  };
}

export function layoutForBranch(branchId) {
  if (branchId === "khobar") return khobarLayout(branchId);
  return developmentLayout(branchId);
}
