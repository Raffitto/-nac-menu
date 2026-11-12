import React, { useRef } from "react";
import { guestName, reservationByTable, tableStatusLabel } from "./serviceShared";
import { KHOBAR_FLOOR_REFERENCE, nudgePosition, resolvePositions } from "./floorLayout";

function roomName(floor) {
  return KHOBAR_FLOOR_REFERENCE.rooms[floor.id]?.name || floor.name || "Floor";
}

export default function FloorPlan({ state, selectedId, onSelect, positions = {}, onMove }) {
  const floors = state.floors?.length
    ? state.floors
    : [{ id: "main", name: "Dining room" }];
  const placed = resolvePositions(state.tables, positions);
  const counts = state.tables.reduce((sum, table) => {
    sum[table.status] = (sum[table.status] || 0) + 1;
    return sum;
  }, {});

  return (
    <div className="svc-rooms">
      <p className="svc-gap">This grid follows the service tables. Furniture position is not part of the service record.</p>
      <p className="svc-legend">
        <span className="svc-status" data-status="open">Available {counts.open || "none"}</span>
        <span className="svc-status" data-status="assigned">Assigned {counts.assigned || "none"}</span>
        <span className="svc-status" data-status="occupied">Occupied {counts.occupied || "none"}</span>
      </p>
      {floors.map((floor) => {
        const tables = state.tables.filter((table) => table.floorId === floor.id);
        const landmarks = KHOBAR_FLOOR_REFERENCE.rooms[floor.id]?.landmarks || [];
        return (
          <section key={floor.id} className="svc-room" aria-label={roomName(floor)} data-floor={floor.id}>
            <h3>{roomName(floor)}</h3>
            <div className="svc-room-canvas">
              {landmarks.map((label) => <span key={label} className="svc-landmark">{label}</span>)}
              {tables.length === 0 && <p>No tables are in service on this floor.</p>}
              {tables.map((table) => (
                <TableToken
                  key={table.id}
                  state={state}
                  table={table}
                  position={placed[table.id]}
                  pressed={selectedId === table.id}
                  onSelect={onSelect}
                  onMove={onMove}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TableToken({ state, table, position, pressed, onSelect, onMove }) {
  const drag = useRef(null);
  const reservation = reservationByTable(state, table.id);
  const seatedNow = reservation && table.status !== "open";

  function commitMove(next) {
    if (next && onMove) onMove(table.id, next);
  }

  function pointerDown(event) {
    if (!onMove || event.button !== 0) return;
    const canvas = event.currentTarget.closest(".svc-room-canvas");
    const rect = canvas?.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pos: position,
      width: rect?.width || 0,
      height: rect?.height || 0,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !active.width || !active.height) return;
    const dx = ((event.clientX - active.x) / active.width) * 100;
    const dy = ((event.clientY - active.y) / active.height) * 100;
    if (Math.abs(dx) + Math.abs(dy) < 1.5) return;
    active.moved = true;
    commitMove({ x: active.pos.x + dx, y: active.pos.y + dy });
  }

  function pointerUp(event) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  function onKeyDown(event) {
    const next = nudgePosition(position, event.key);
    if (!next || !onMove) return;
    event.preventDefault();
    commitMove(next);
  }

  return (
    <button
      type="button"
      className="svc-table svc-table-token"
      data-status={table.status}
      data-x={position?.x}
      data-y={position?.y}
      aria-pressed={pressed}
      style={{ left: `${position?.x ?? 50}%`, top: `${position?.y ?? 50}%` }}
      onClick={() => onSelect(table.id)}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onKeyDown={onKeyDown}
    >
      <span className="svc-table-label">Table {table.label}</span>
      <span className="svc-status" data-status={table.status}>{tableStatusLabel(table.status)}</span>
      <span>{Number.isFinite(table.seats) ? `${table.seats} seats` : "Seats unverified"}</span>
      <span>{seatedNow ? guestName(state, reservation.guestId) : "No guest"}</span>
      <span>{seatedNow ? `${reservation.partySize} covers` : "Covers not seated"}</span>
    </button>
  );
}
