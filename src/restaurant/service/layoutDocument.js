/**
 * Floor layouts live in development storage. They store geometry only.
 * Seat counts, occupancy, and dining sessions stay on createRestaurant.
 */
import { serviceTableId } from "../layouts/branchLayouts";
import { KHOBAR_TABLES } from "../layouts/khobarFloor";

export const LAYOUT_STORAGE_KEY = "nac-khobar-layouts:v1";

/** View windows for the host desk. They do not create a booking cap. */
export const DEFAULT_SHIFTS = Object.freeze([
  { id: "breakfast", label: "Breakfast", start: "07:00", end: "11:00" },
  { id: "lunch", label: "Lunch", start: "11:00", end: "17:00" },
  { id: "dinner", label: "Dinner", start: "17:00", end: "23:30" },
]);

function tableFromReference(table) {
  return {
    id: serviceTableId("khobar", table.label),
    label: table.label,
    name: "",
    shape: table.shape === "round" ? "round" : "square",
    x: table.x,
    y: table.y,
    w: table.shape === "round" ? 4.4 : 4.8,
    h: 4.4,
    zone: table.zone,
    active: true,
    removed: false,
  };
}

export function canonicalLayoutId(table) {
  if (String(table.id || "").startsWith("layout-")) return table.id;
  if (String(table.id || "").includes(":")) return table.id;
  return serviceTableId("khobar", table.label);
}

function migrateTable(table) {
  const next = { ...table, id: canonicalLayoutId(table) };
  delete next.minSeats;
  delete next.maxSeats;
  return next;
}

export function defaultLayoutDocument() {
  return {
    seq: 1,
    activeId: "weekday",
    layouts: [
      {
        id: "weekday",
        name: "Weekday",
        period: "all",
        tables: KHOBAR_TABLES.map(tableFromReference),
        walls: [
          { id: "wall-outdoor", x1: 2, y1: 18, x2: 98, y2: 18 },
          { id: "wall-indoor", x1: 2, y1: 40, x2: 80, y2: 40 },
        ],
        elements: [
          { id: "el-wait", kind: "structure", label: "Waiting area", x: 3, y: 23, w: 26, h: 14 },
          { id: "el-bar", kind: "structure", label: "Bar", x: 36, y: 72, w: 16, h: 12 },
          { id: "el-kitchen", kind: "structure", label: "Kitchen", x: 6, y: 87, w: 26, h: 9 },
        ],
        combinations: [],
        shifts: DEFAULT_SHIFTS.map((shift) => ({ ...shift })),
      },
    ],
    audit: [],
  };
}

export function loadLayoutDocument(storage) {
  if (!storage) return defaultLayoutDocument();
  try {
    const parsed = JSON.parse(storage.getItem(LAYOUT_STORAGE_KEY) || "null");
    if (!parsed?.layouts?.length || !parsed.activeId) return defaultLayoutDocument();
    return {
      ...parsed,
      layouts: parsed.layouts.map((layout) => ({
        ...layout,
        tables: (layout.tables || []).map(migrateTable),
      })),
    };
  } catch {
    return defaultLayoutDocument();
  }
}

export function saveLayoutDocument(storage, document) {
  if (!storage) return document;
  storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(document));
  return document;
}

export function activeLayout(document) {
  return document.layouts.find((layout) => layout.id === document.activeId) || document.layouts[0];
}

export function serviceLock(serviceState, label) {
  const row = (serviceState?.tables || []).find((table) => String(table.label) === String(label));
  if (!row || row.removed) return null;
  if (row.sessionId || row.combinedWith || ["occupied", "assigned", "combined"].includes(row.status)) return row.status;
  return null;
}

function withAudit(document, action, entityId) {
  return {
    ...document,
    audit: [...document.audit, { action, entityId, at: document.audit.length + 1 }].slice(-80),
  };
}

function mapLayout(document, layoutId, change) {
  return {
    ...document,
    layouts: document.layouts.map((layout) => (layout.id === layoutId ? change(layout) : layout)),
  };
}

export function editTable(document, layoutId, tableId, patch, serviceState) {
  const layout = document.layouts.find((row) => row.id === layoutId);
  const table = layout?.tables.find((row) => row.id === tableId);
  if (!table) return { ok: false, reason: "table_not_in_layout", document };
  if (String(table.id).includes(":") && patch.label != null && String(patch.label) !== String(table.label)) {
    return { ok: false, reason: "table_identity_locked", document };
  }
  const lock = serviceLock(serviceState, table.label);
  const moving = patch.x != null || patch.y != null || patch.w != null || patch.h != null || patch.rotation != null || patch.deleted === true;
  if (table.locked && patch.locked !== false && moving) return { ok: false, reason: "table_locked", document };
  const destructive = patch.label != null || patch.active === false || patch.deleted === true;
  if (lock && destructive) return { ok: false, reason: "table_in_service", document, status: lock };
  if (patch.deleted) {
    const next = withAudit(mapLayout(document, layoutId, (row) => ({
      ...row,
      tables: row.tables.filter((item) => item.id !== tableId),
      combinations: row.combinations.filter((combo) => !combo.tableIds.includes(tableId)),
    })), "table_deleted", tableId);
    return { ok: true, document: next };
  }
  const nextTable = { ...table, ...patch, id: table.id };
  const next = withAudit(mapLayout(document, layoutId, (row) => ({
    ...row,
    tables: row.tables.map((item) => (item.id === tableId ? nextTable : item)),
  })), "table_edited", tableId);
  return { ok: true, document: next };
}

export function addTable(document, layoutId) {
  const seq = document.seq + 1;
  const table = {
    id: `layout-${seq}`,
    label: `N${seq}`,
    name: "",
    shape: "square",
    x: 50,
    y: 50,
    w: 4.8,
    h: 4.4,
    zone: "indoor",
    active: true,
    removed: false,
  };
  const next = withAudit({
    ...mapLayout(document, layoutId, (row) => ({ ...row, tables: [...row.tables, table] })),
    seq,
  }, "table_added", table.id);
  return { ok: true, document: next, table };
}

export function duplicateTable(document, layoutId, tableId) {
  const layout = document.layouts.find((row) => row.id === layoutId);
  const source = layout?.tables.find((row) => row.id === tableId);
  if (!source) return { ok: false, reason: "table_not_in_layout", document };
  const seq = document.seq + 1;
  const table = {
    ...source,
    id: `layout-${seq}`,
    label: `${source.label} copy`,
    x: Math.min(96, Number(source.x) + 4),
    locked: false,
    removed: false,
    active: true,
  };
  const next = withAudit({
    ...mapLayout(document, layoutId, (row) => ({ ...row, tables: [...row.tables, table] })),
    seq,
  }, "table_duplicated", table.id);
  return { ok: true, document: next, table };
}

export function addStructure(document, layoutId, kind = "wall") {
  const seq = document.seq + 1;
  const element = {
    id: `el-${seq}`,
    kind: "structure",
    structure: kind,
    label: kind,
    x: 40,
    y: 40,
    w: 16,
    h: 8,
  };
  const next = withAudit({
    ...mapLayout(document, layoutId, (row) => ({ ...row, elements: [...(row.elements || []), element] })),
    seq,
  }, "structure_added", element.id);
  return { ok: true, document: next, element };
}

export function alignTables(document, layoutId, tableIds, edge = "left") {
  const layout = document.layouts.find((row) => row.id === layoutId);
  const chosen = (layout?.tables || []).filter((table) => tableIds.includes(table.id) && !table.locked);
  if (chosen.length < 2) return { ok: false, reason: "align_needs_two_tables", document };
  const anchor = edge === "top"
    ? Math.min(...chosen.map((table) => Number(table.y)))
    : Math.min(...chosen.map((table) => Number(table.x)));
  const next = withAudit(mapLayout(document, layoutId, (row) => ({
    ...row,
    tables: row.tables.map((table) => {
      if (!chosen.some((item) => item.id === table.id)) return table;
      return edge === "top" ? { ...table, y: anchor } : { ...table, x: anchor };
    }),
  })), "tables_aligned", chosen.map((table) => table.id).join(","));
  return { ok: true, document: next };
}

export function publishLayout(document, layoutId) {
  const layout = document.layouts.find((row) => row.id === layoutId);
  if (!layout) return { ok: false, reason: "layout_not_found", document };
  const seq = document.seq + 1;
  const version = {
    id: `published-${seq}`,
    layoutId,
    snapshot: JSON.parse(JSON.stringify(layout)),
  };
  const next = withAudit({
    ...document,
    seq,
    versions: [...(document.versions || []), version].slice(-12),
  }, "layout_published", version.id);
  return { ok: true, document: next, version };
}

export function restoreLayoutVersion(document, versionId) {
  const version = (document.versions || []).find((row) => row.id === versionId);
  if (!version?.snapshot) return { ok: false, reason: "version_not_found", document };
  const restored = JSON.parse(JSON.stringify(version.snapshot));
  const exists = document.layouts.some((row) => row.id === restored.id);
  const layouts = exists
    ? document.layouts.map((row) => (row.id === restored.id ? restored : row))
    : [...document.layouts, restored];
  const next = withAudit({
    ...document,
    seq: document.seq + 1,
    activeId: restored.id,
    layouts,
  }, "layout_restored", versionId);
  return { ok: true, document: next };
}

export function addCombination(document, layoutId, tableIds, name) {
  const unique = [...new Set(tableIds)];
  if (unique.length < 2) return { ok: false, reason: "combine_needs_two_tables", document };
  const combo = { id: `combo-${document.seq + 1}`, name: name || "Combination", tableIds: unique };
  const next = withAudit({
    ...mapLayout(document, layoutId, (row) => ({ ...row, combinations: [...row.combinations, combo] })),
    seq: document.seq + 1,
  }, "combination_saved", combo.id);
  return { ok: true, document: next, combination: combo };
}

export function duplicateLayout(document, layoutId, name) {
  const source = document.layouts.find((row) => row.id === layoutId);
  if (!source) return { ok: false, reason: "layout_not_found", document };
  const id = `layout-${document.seq + 1}`;
  const copy = JSON.parse(JSON.stringify(source));
  copy.id = id;
  copy.name = name || `${source.name} copy`;
  const next = withAudit({
    ...document,
    seq: document.seq + 1,
    activeId: id,
    layouts: [...document.layouts, copy],
  }, "layout_duplicated", id);
  return { ok: true, document: next };
}

export function snapValue(value, enabled, size = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const clamped = Math.min(96, Math.max(2, number));
  if (!enabled) return Math.round(clamped * 10) / 10;
  return Math.min(96, Math.max(2, Math.round(clamped / size) * size));
}

export function createHistory(document) {
  return { past: [], present: document, future: [] };
}

export function commitHistory(history, document) {
  return { past: [...history.past, history.present].slice(-40), present: document, future: [] };
}

export function undoHistory(history) {
  if (!history.past.length) return history;
  const present = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present, future: [history.present, ...history.future] };
}

export function redoHistory(history) {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}
