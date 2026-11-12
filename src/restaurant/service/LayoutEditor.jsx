import React, { useEffect, useState } from "react";
import FloorCanvas from "./FloorCanvas";
import {
  activeLayout,
  addCombination,
  addStructure,
  addTable,
  alignTables,
  commitHistory,
  createHistory,
  defaultLayoutDocument,
  duplicateLayout,
  duplicateTable,
  editTable,
  publishLayout,
  redoHistory,
  restoreLayoutVersion,
  DEFAULT_SHIFTS,
  saveLayoutDocument,
  serviceLock,
  snapValue,
  undoHistory,
} from "./layoutDocument";

const ZONES = ["indoor", "outdoor", "bar", "kitchen", "waiting"];

export default function LayoutEditor({ serviceState, layoutStorage, initialDocument, onClose, onSaved, onOperate, databaseMode = false }) {
  const [history, setHistory] = useState(() => createHistory(initialDocument || defaultLayoutDocument()));
  const [selectedId, setSelectedId] = useState(null);
  const [snap, setSnap] = useState(true);
  const [grid, setGrid] = useState(true);
  const [layoutName, setLayoutName] = useState("");
  const [notice, setNotice] = useState("");
  const document = history.present;
  const layout = activeLayout(document);
  const selected = layout.tables.find((table) => table.id === selectedId) || null;
  const serviceRow = selected ? serviceState.tables.find((row) => row.id === selected.id) : null;
  const lock = selected ? serviceLock(serviceState, selected.label) : null;
  const [minDraft, setMinDraft] = useState("");
  const [maxDraft, setMaxDraft] = useState("");
  const [pickedIds, setPickedIds] = useState([]);

  useEffect(() => {
    function onKey(event) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      setHistory(event.shiftKey ? redoHistory : undoHistory);
    }
    function warn(event) {
      if (!history.past.length) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", warn);
    };
  }, [history.past.length]);

  useEffect(() => {
    setMinDraft(serviceRow?.capacity === "verified" ? String(serviceRow.minSeats) : "");
    setMaxDraft(serviceRow?.capacity === "verified" ? String(serviceRow.maxSeats) : "");
  }, [serviceRow?.id, serviceRow?.capacity, serviceRow?.minSeats, serviceRow?.maxSeats]);

  function apply(result) {
    if (!result.ok) {
      setNotice(result.reason === "table_in_service"
        ? `Table ${selected?.label || ""} is ${result.status}. The layout keeps it.`
        : result.reason.replaceAll("_", " "));
      return;
    }
    setHistory((current) => commitHistory(current, result.document));
    if (result.table) setSelectedId(result.table.id);
    setNotice("");
  }

  function patch(next) {
    if (!selected) return;
    const point = { ...next };
    if (point.x != null) point.x = snapValue(point.x, snap);
    if (point.y != null) point.y = snapValue(point.y, snap);
    apply(editTable(document, layout.id, selected.id, point, serviceState));
  }

  function capacityLabel(table) {
    const service = serviceState.tables.find((row) => row.id === table.id);
    if (service?.capacity === "verified") return `${service.minSeats}–${service.maxSeats}`;
    if (service?.removed) return "removed";
    if (service && service.active === false) return "inactive";
    return "seats unverified";
  }

  function setCapacity() {
    if (!serviceRow) {
      setNotice("This table is not in the service book. Seats stay unverified.");
      return;
    }
    const result = onOperate(
      "configureCapacity",
      [serviceRow.id, { minSeats: Number(minDraft), maxSeats: Number(maxDraft) }],
      `Table ${serviceRow.label} seats ${minDraft} to ${maxDraft}.`,
    );
    if (!result?.ok) setNotice("Enter a minimum and a maximum. Empty seats stay unverified.");
  }

  function toggleActive(checked) {
    if (!serviceRow) {
      patch({ active: checked });
      return;
    }
    const result = onOperate(
      checked ? "activateTable" : "deactivateTable",
      serviceRow.id,
      checked ? `Table ${serviceRow.label} is active.` : `Table ${serviceRow.label} is inactive.`,
    );
    if (!result?.ok) setNotice(`Table ${serviceRow.label} stays ${serviceRow.status}.`);
  }

  function retire() {
    if (!selected || lock) return;
    if (serviceRow) {
      if (serviceRow.active !== false) {
        const off = onOperate("deactivateTable", serviceRow.id, `Table ${serviceRow.label} is inactive.`);
        if (!off?.ok) {
          setNotice(`Table ${serviceRow.label} stays in service.`);
          return;
        }
      }
      const removed = onOperate("removeTable", serviceRow.id, `Table ${serviceRow.label} is removed from service. Its identity is kept.`);
      if (!removed?.ok) {
        setNotice(`Table ${serviceRow.label} is inactive and still on the book.`);
        return;
      }
    }
    apply(editTable(document, layout.id, selected.id, { active: false, removed: true }, serviceState));
  }

  function save() {
    saveLayoutDocument(layoutStorage, document);
    onSaved(document);
    setNotice("Layout saved in development storage.");
  }

  return (
    <div className="le-shell">
      <header className="le-bar">
        <strong>{layout.name}</strong>
        <button type="button" onClick={() => setHistory(undoHistory)} disabled={!history.past.length}>Undo</button>
        <button type="button" onClick={() => setHistory(redoHistory)} disabled={!history.future.length}>Redo</button>
        <button type="button" onClick={() => apply(addTable(document, layout.id))}>Add table</button>
        <button type="button" disabled={!selected} onClick={() => selected && apply(duplicateTable(document, layout.id, selected.id))}>Duplicate table</button>
        <button type="button" onClick={() => apply(addStructure(document, layout.id, "entrance"))}>Add entrance</button>
        <button type="button" onClick={() => {
          const published = publishLayout(document, layout.id);
          if (!published.ok) {
            setNotice(published.reason.replaceAll("_", " "));
            return;
          }
          apply(published);
          saveLayoutDocument(layoutStorage, published.document);
          onSaved(published.document);
          setNotice(databaseMode
            ? "Published version saved in the local development database. Occupied tables stay in service."
            : "Published version saved in this browser only. It is not a production database.");
        }}>Publish version</button>
        <button type="button" aria-pressed={grid} onClick={() => setGrid((value) => !value)}>Grid</button>
        <button type="button" aria-pressed={snap} onClick={() => setSnap((value) => !value)}>Snap</button>
        <button type="button" onClick={save}>Save layout</button>
        <button type="button" onClick={() => { setHistory(createHistory(initialDocument)); setNotice(""); }}>Cancel</button>
        <button type="button" onClick={() => setHistory(createHistory(defaultLayoutDocument()))}>Restore default</button>
        <button type="button" onClick={onClose}>Close editor</button>
      </header>
      {notice && <p role="status">{notice}</p>}
      <div className="le-body">
        <aside className="le-list" aria-label="Layout tables">
          <label>
            Layout name
            <input value={layoutName} onChange={(event) => setLayoutName(event.target.value)} />
          </label>
          <button type="button" onClick={() => apply(duplicateLayout(document, layout.id, layoutName || "Shift copy"))}>
            New layout
          </button>
          <label>
            Service period
            <select
              aria-label="Service period"
              value={layout.period}
              onChange={(event) => apply({
                ok: true,
                document: {
                  ...document,
                  layouts: document.layouts.map((row) => (row.id === layout.id ? { ...row, period: event.target.value } : row)),
                },
              })}
            >
              <option value="all">All service</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </label>
          {(layout.shifts || DEFAULT_SHIFTS).map((shift) => (
            <div key={shift.id} className="le-shift">
              <span>{shift.label}</span>
              <input
                aria-label={`${shift.label} starts`}
                value={shift.start}
                onChange={(event) => apply({
                  ok: true,
                  document: {
                    ...document,
                    layouts: document.layouts.map((row) => (row.id === layout.id ? {
                      ...row,
                      shifts: (row.shifts || DEFAULT_SHIFTS).map((item) => (item.id === shift.id ? { ...item, start: event.target.value } : item)),
                    } : row)),
                  },
                })}
              />
              <input
                aria-label={`${shift.label} ends`}
                value={shift.end}
                onChange={(event) => apply({
                  ok: true,
                  document: {
                    ...document,
                    layouts: document.layouts.map((row) => (row.id === layout.id ? {
                      ...row,
                      shifts: (row.shifts || DEFAULT_SHIFTS).map((item) => (item.id === shift.id ? { ...item, end: event.target.value } : item)),
                    } : row)),
                  },
                })}
              />
            </div>
          ))}
          <ul>
            {document.layouts.map((row) => (
              <li key={row.id}>
                <button type="button" aria-pressed={row.id === document.activeId} onClick={() => apply({ ok: true, document: { ...document, activeId: row.id } })}>
                  {row.name} · {row.period}
                </button>
              </li>
            ))}
          </ul>
          <ul>
            {layout.tables.map((table) => (
              <li key={table.id}>
                <button type="button" aria-pressed={table.id === selectedId} onClick={() => setSelectedId(table.id)}>
                  {table.label} · {capacityLabel(table)}
                  {serviceLock(serviceState, table.label) ? " · in service" : ""}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <FloorCanvas
          state={serviceState}
          tables={layout.tables}
          selectedLabel={selected?.label}
          showGrid={grid}
          showInactive
          onSelect={(label) => {
            const table = layout.tables.find((row) => row.label === label);
            if (table) setSelectedId(table.id);
          }}
          onMove={(label, next) => {
            const table = layout.tables.find((row) => row.label === label);
            if (!table) return;
            setSelectedId(table.id);
            const result = editTable(document, layout.id, table.id, {
              x: snapValue(next.x, snap),
              y: snapValue(next.y, snap),
            }, serviceState);
            if (result.ok) setHistory((current) => ({ ...current, present: result.document }));
          }}
          onResize={(label, size) => {
            const table = layout.tables.find((row) => row.label === label);
            if (!table) return;
            const result = editTable(document, layout.id, table.id, size, serviceState);
            if (result.ok) setHistory((current) => ({ ...current, present: result.document }));
          }}
        />
        <aside className="le-props" aria-label="Table properties">
          {!selected && <p>Select a table.</p>}
          {selected && (
            <form onSubmit={(event) => event.preventDefault()}>
              <p>{selected.id}</p>
              <label>
                Table number
                <input value={selected.label} disabled={Boolean(lock) || Boolean(serviceRow)} onChange={(event) => patch({ label: event.target.value })} />
              </label>
              <label>
                Name
                <input value={selected.name} onChange={(event) => patch({ name: event.target.value })} />
              </label>
              <label>
                Shape
                <select value={selected.shape} onChange={(event) => patch({ shape: event.target.value })}>
                  <option value="round">Round</option>
                  <option value="square">Square</option>
                  <option value="rect">Rectangular</option>
                  <option value="oval">Oval</option>
                  <option value="booth">Booth</option>
                  <option value="sofa">Sofa seating</option>
                  <option value="counter">Counter seating</option>
                  <option value="communal">Communal table</option>
                </select>
              </label>
              <label>
                Minimum seats
                <input
                  inputMode="numeric"
                  value={minDraft}
                  placeholder="Unverified"
                  onChange={(event) => setMinDraft(event.target.value)}
                />
              </label>
              <label>
                Maximum seats
                <input
                  inputMode="numeric"
                  value={maxDraft}
                  placeholder="Unverified"
                  onChange={(event) => setMaxDraft(event.target.value)}
                />
              </label>
              <button type="button" disabled={!serviceRow} onClick={setCapacity}>Set capacity</button>
              {!serviceRow && <p>Not in the service book. Seats stay unverified.</p>}
              <label>
                Area
                <select value={selected.zone} onChange={(event) => patch({ zone: event.target.value })}>
                  {ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
              </label>
              <label>
                Width
                <input inputMode="decimal" value={selected.w} onChange={(event) => patch({ w: Number(event.target.value) })} />
              </label>
              <label>
                Height
                <input inputMode="decimal" value={selected.h} onChange={(event) => patch({ h: Number(event.target.value) })} />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={selected.locked === true}
                  onChange={(event) => patch({ locked: event.target.checked })}
                />
                Lock position
              </label>
              <button type="button" onClick={() => patch({ rotation: ((Number(selected.rotation) || 0) + 90) % 360 })}>Rotate</button>
              <button
                type="button"
                onClick={() => apply(alignTables(document, layout.id, [...new Set([selected.id, ...pickedIds])], "left"))}
              >
                Align left
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={pickedIds.includes(selected.id)}
                  onChange={(event) => setPickedIds((ids) => (
                    event.target.checked ? [...ids, selected.id] : ids.filter((id) => id !== selected.id)
                  ))}
                />
                Include in multi-select
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={serviceRow ? serviceRow.active !== false && !serviceRow.removed : selected.active !== false}
                  disabled={Boolean(lock)}
                  onChange={(event) => toggleActive(event.target.checked)}
                />
                Active
              </label>
              {lock && <p>Table {selected.label} is {lock}. Number, active state, and delete stay locked.</p>}
              <button type="button" disabled={Boolean(lock)} onClick={retire}>Delete table</button>
              <button
                type="button"
                onClick={() => apply(addCombination(document, layout.id, [selected.id, layout.tables.find((row) => row.id !== selected.id)?.id].filter(Boolean), `${selected.label} pair`))}
              >
                Save combination with the next table
              </button>
              {layout.combinations.length > 0 && (
                <ul>
                  {layout.combinations.map((combo) => <li key={combo.id}>{combo.name}</li>)}
                </ul>
              )}
              <p>This combination is saved on the layout. Combine the open session from the host desk to hold the tables.</p>
            </form>
          )}
          <h2>Published versions</h2>
          {(document.versions || []).length === 0 && <p>No published version yet.</p>}
          <ul>
            {(document.versions || []).map((version) => (
              <li key={version.id}>
                <button type="button" onClick={() => apply(restoreLayoutVersion(document, version.id))}>
                  Restore {version.id}
                </button>
              </li>
            ))}
          </ul>
          <h2>Layout audit</h2>
          <ul>
            {document.audit.slice(-6).reverse().map((entry) => (
              <li key={`${entry.at}-${entry.action}`}>{entry.action} · {entry.entityId}</li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
