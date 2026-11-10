import React, { useEffect, useRef, useState } from "react";
import { guestName, reservationByTable, tableStatusLabel } from "./serviceShared";
import { KHOBAR_ZONES, clampZoom, placedTables } from "../layouts/khobarFloor";
import { nudgePosition } from "./floorLayout";

export default function FloorCanvas({
  state,
  tables,
  areas = [],
  onMoveArea,
  selectedLabel,
  onSelect,
  onMove,
  showGrid = false,
  showInactive = false,
  hotLabel = null,
  pickedLabels = [],
  onPullGuest,
  onResize,
  initialFit = false,
}) {
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef(null);
  const viewportRef = useRef(null);

  function fitFloor() {
    const node = viewportRef.current;
    if (!node) {
      setView({ x: 0, y: 0, scale: 1 });
      return;
    }
    const scale = clampZoom(Math.min(node.clientWidth / 760, node.clientHeight / 980) * 0.96);
    setView({
      x: Math.max(12, (node.clientWidth - 760 * scale) / 2),
      y: 12,
      scale,
    });
  }

  useEffect(() => {
    if (!initialFit) return undefined;
    const node = viewportRef.current;
    if (!node) return undefined;
    function apply() {
      if (node.clientWidth < 40 || node.clientHeight < 40) return;
      const scale = clampZoom(Math.min(node.clientWidth / 760, node.clientHeight / 980) * 0.96);
      setView({
        x: Math.max(12, (node.clientWidth - 760 * scale) / 2),
        y: 12,
        scale,
      });
    }
    apply();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [initialFit]);
  const source = tables?.length ? tables : placedTables({});
  const placed = source.filter((table) => showInactive || (table.active !== false && !table.removed));

  function zoom(direction) {
    setView((current) => ({ ...current, scale: clampZoom(direction === "in" ? current.scale * 1.2 : current.scale / 1.2) }));
  }

  function backgroundDown(event) {
    if (event.target !== event.currentTarget) return;
    drag.current = { kind: "pan", pointerId: event.pointerId, x: event.clientX, y: event.clientY, view };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function backgroundMove(event) {
    const active = drag.current;
    if (!active || active.kind !== "pan" || active.pointerId !== event.pointerId) return;
    setView({
      ...active.view,
      x: active.view.x + (event.clientX - active.x),
      y: active.view.y + (event.clientY - active.y),
    });
  }

  function backgroundUp(event) {
    if (drag.current?.kind === "pan" && drag.current.pointerId === event.pointerId) drag.current = null;
  }

  return (
    <div className="kh-floor-wrap">
      <div className="kh-zoom">
        <button type="button" onClick={() => zoom("out")}>Zoom out</button>
        <button type="button" onClick={() => zoom("in")}>Zoom in</button>
        <button type="button" onClick={fitFloor}>Fit floor</button>
      </div>
      <div
        ref={viewportRef}
        className="kh-viewport"
        onPointerDown={backgroundDown}
        onPointerMove={backgroundMove}
        onPointerUp={backgroundUp}
      >
        <div
          className={showGrid ? "kh-world kh-grid" : "kh-world"}
          data-scale={view.scale}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <svg className="kh-zones" viewBox="0 0 100 100" aria-hidden="true">
            {KHOBAR_ZONES.map((zone) => (
              <polygon key={zone.id} points={zone.points} />
            ))}
            {KHOBAR_ZONES.map((zone) => {
              const [x, y] = zone.points.split(" ")[0].split(",");
              return <text key={`${zone.id}-label`} x={x} y={Number(y) + 3}>{zone.name}</text>;
            })}
          </svg>
          {areas.map((area) => (
            <AreaBox key={area.id} area={area} onMove={onMoveArea} />
          ))}
          {placed.map((table) => (
            <MapTable
              key={table.id || table.label}
              state={state}
              table={table}
              pressed={selectedLabel === table.label}
              onSelect={onSelect}
              onMove={onMove}
              hot={hotLabel === table.label}
              picked={pickedLabels.includes(table.label)}
              onPullGuest={onPullGuest}
              onResize={onResize}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AreaBox({ area, onMove }) {
  const drag = useRef(null);
  function pointerDown(event) {
    if (!onMove) return;
    event.stopPropagation();
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pos: { x: area.x, y: area.y } };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function pointerMove(event) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !onMove) return;
    const parent = event.currentTarget.offsetParent;
    const width = parent?.clientWidth || 1;
    const height = parent?.clientHeight || 1;
    const dx = ((event.clientX - active.x) / width) * 100;
    const dy = ((event.clientY - active.y) / height) * 100;
    if (Math.abs(dx) + Math.abs(dy) < 0.8) return;
    onMove(area.id, { x: active.pos.x + dx, y: active.pos.y + dy });
  }
  function pointerUp(event) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }
  return (
    <div
      className="kh-area"
      role="group"
      aria-label={area.label}
      style={{ left: `${area.x}%`, top: `${area.y}%`, width: `${area.w}%`, height: `${area.h}%` }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
    >
      <span>{area.label}</span>
      {onMove && (
        <button
          type="button"
          className="kh-handle"
          aria-label={`Resize ${area.label}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onMove(area.id, { w: Number(area.w) + 4, h: Number(area.h) + 3 });
          }}
        />
      )}
    </div>
  );
}

function seatText(service) {
  if (!service || service.capacity !== "verified" || !Number.isFinite(service.maxSeats)) return "Seats unverified";
  return `${service.minSeats} to ${service.maxSeats} seats`;
}

function MapTable({ state, table, pressed, onSelect, onMove, hot, picked, onPullGuest, onResize }) {
  const drag = useRef(null);
  const service = state.tables.find((row) => row.id === table.id)
    || state.tables.find((row) => row.label === table.label && !String(table.id || "").startsWith("layout-"))
    || null;
  const reservation = service ? reservationByTable(state, service.id) : null;
  const seated = Boolean(reservation && service.status !== "open");
  const status = service ? tableStatusLabel(service.status) : "Map only";

  function commit(next) {
    if (next && onMove) onMove(table.label, next);
  }

  function pointerDown(event) {
    event.stopPropagation();
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pos: { x: table.x, y: table.y },
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const parent = event.currentTarget.offsetParent;
    const width = parent?.clientWidth || 1;
    const height = parent?.clientHeight || 1;
    const dx = ((event.clientX - active.x) / width) * 100;
    const dy = ((event.clientY - active.y) / height) * 100;
    if (Math.abs(dx) + Math.abs(dy) < 0.8) return;
    active.moved = true;
    commit({ x: active.pos.x + dx, y: active.pos.y + dy });
  }

  function pointerUp(event) {
    const active = drag.current;
    if (active?.pointerId === event.pointerId) {
      if (!onMove && active.moved && onPullGuest) onPullGuest(table.label, event.clientX, event.clientY);
      drag.current = null;
    }
  }

  function onKeyDown(event) {
    if (!onMove) return;
    const next = nudgePosition({ x: table.x, y: table.y }, event.key);
    if (!next) return;
    event.preventDefault();
    commit(next);
  }

  return (
    <button
      type="button"
      className={`kh-table kh-${table.shape}${service?.active === false || service?.removed || table.removed ? " kh-inactive" : ""}${hot ? " kh-hot" : ""}${picked ? " kh-pick" : ""}`}
      data-status={service ? service.status : "map"}
      data-label={table.label}
      data-x={table.x}
      data-y={table.y}
      data-session={service?.sessionId || ""}
      data-service={service ? "true" : "false"}
      aria-pressed={pressed}
      style={{ left: `${table.x}%`, top: `${table.y}%`, width: table.w ? `${Math.max(40, table.w * 10)}px` : undefined, height: table.h ? `${Math.max(40, table.h * 10)}px` : undefined, transform: `translate(-50%, -50%) rotate(${Number(table.rotation) || 0}deg)` }}
      onClick={() => onSelect(table.label)}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onKeyDown={onKeyDown}
    >
      <span className="kh-num">{table.label}</span>
      {seated && (
        <span className="kh-guest">
          {guestName(state, reservation.guestId)}
          <small>{reservation.partySize}</small>
        </span>
      )}
      {onResize && (
        <span
          className="kh-handle"
          aria-hidden="true"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            const start = { x: event.clientX, y: event.clientY, w: table.w || 4.8, h: table.h || 4.4, pointerId: event.pointerId };
            function move(next) {
              if (next.pointerId !== start.pointerId) return;
              onResize(table.label, {
                w: Math.max(3, Math.round((start.w + (next.clientX - start.x) / 12) * 10) / 10),
                h: Math.max(3, Math.round((start.h + (next.clientY - start.y) / 12) * 10) / 10),
              });
            }
            function up(next) {
              move(next);
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            }
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
      )}
      <span className="svc-sr">Table {table.label} {status}</span>
      <span className="svc-sr">{seatText(service)}</span>
      <span className="svc-sr">{seated ? guestName(state, reservation.guestId) : "No guest"}</span>
      {seated && <span className="svc-sr">{reservation.partySize} covers</span>}
    </button>
  );
}
