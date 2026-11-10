import React, { useRef, useState } from "react";
import FloorCanvas from "./FloorCanvas";
import { currentSeatedCovers, guestHistory } from "../platformContract";
import { serviceDateValue as dateValue, shiftServiceDate } from "./floorLayout";
import { DEFAULT_SHIFTS, activeLayout } from "./layoutDocument";
import { recommendTables } from "./seatingAdvice";
import { KHOBAR_TABLES } from "../layouts/khobarFloor";
import {
  formatServiceTime,
  guestName,
  statusLabel,
  tableStatusLabel,
} from "./serviceShared";

const GROUPS = [
  ["upcoming", "Upcoming", (row) => row.status === "booked"],
  ["arrived", "Arrived", (row) => row.status === "arrived"],
  ["seated", "Seated", (row) => row.status === "seated"],
  ["left", "Left", (row) => row.status === "completed"],
  ["cancelled", "Cancelled", (row) => row.status === "cancelled"],
  ["no_show", "No-show", (row) => row.status === "no_show"],
];

const AREAS = [
  ["indoor", "Indoor"],
  ["outdoor", "Outdoor"],
  ["bar", "Bar"],
  ["waiting", "Waiting area"],
];
const DURATIONS = ["60", "90", "120", "150"];
const TAGS = ["VIP", "Birthday", "Anniversary", "Allergy"];
const PERKS = ["Window", "Quiet", "High chair", "Birthday dessert"];

function serviceable(table) {
  return Boolean(table && table.status === "open" && table.active !== false && !table.removed);
}

function hostTables(layout, state) {
  if (!layout?.tables) return null;
  return layout.tables.filter((table) => {
    const service = state.tables.find((row) => row.id === table.id);
    if (service) return service.active !== false && !service.removed;
    return table.active !== false && !table.removed;
  });
}

function onServiceDate(reservation, serviceDate, today) {
  if (serviceDate === today && ["arrived", "seated"].includes(reservation.status)) return true;
  if (reservation.date) return reservation.date === serviceDate;
  return serviceDate === today;
}

function coversOf(rows) {
  if (rows.some((row) => !Number.isFinite(row.partySize))) return null;
  return rows.reduce((sum, row) => sum + row.partySize, 0);
}

export default function HostWorkspace({ restaurant, dispatch, report, screen, setScreen, currentTime, onRole, layoutDoc }) {
  const state = restaurant.state;
  const khobar = state.branchId === "khobar";
  const today = dateValue(new Date(currentTime));
  const layout = layoutDoc ? activeLayout(layoutDoc) : null;
  const shifts = layout?.shifts?.length ? layout.shifts : DEFAULT_SHIFTS;
  const [name, setName] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [time, setTime] = useState("19:30");
  const [serviceDate, setServiceDate] = useState(today);
  const [shiftId, setShiftId] = useState("dinner");
  const [selectedReservationId, setSelectedReservationId] = useState(null);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [guestQuery, setGuestQuery] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [waitName, setWaitName] = useState("");
  const [waitParty, setWaitParty] = useState("2");
  const [draft, setDraft] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [mode, setMode] = useState(null);
  const [joinIds, setJoinIds] = useState([]);
  const [openGroups, setOpenGroups] = useState({});
  const [waitOpen, setWaitOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState("indoor");
  const [duration, setDuration] = useState("90");
  const [tags, setTags] = useState([]);
  const [perk, setPerk] = useState("");
  const [note, setNote] = useState("");
  const dropRef = useRef(null);

  const shift = shifts.find((row) => row.id === shiftId) || shifts[shifts.length - 1];
  const query = guestQuery.trim().toLowerCase();
  const dayReservations = state.reservations.filter((row) => onServiceDate(row, serviceDate, today));
  const visibleReservations = dayReservations.filter((row) => matchesShift(row, shift) && matchesQuery(state, row, query));
  const selectedReservation = state.reservations.find((row) => row.id === selectedReservationId) || null;
  const selectedTable = state.tables.find((row) => row.id === selectedTableId)
    || state.tables.find((row) => row.label === selectedLabel)
    || null;
  const activeLabel = selectedLabel || selectedTable?.label || null;
  const mapService = selectedTable && selectedTable.label === activeLabel ? selectedTable : state.tables.find((row) => row.label === activeLabel) || null;
  const profileGuest = state.guests.find((guest) => guest.id === (profileId || selectedReservation?.guestId)) || null;
  const history = profileGuest ? guestHistory({ guest: profileGuest, visits: state.visits, branchId: state.branchId }) : null;
  const guests = state.guests.filter((guest) => !query || guest.name.toLowerCase().includes(query));
  const seatedSession = state.sessions.find((row) => row.status === "open" && row.reservationId === selectedReservation?.id)
    || state.sessions.find((row) => row.status === "open")
    || null;
  const sessionTable = state.tables.find((row) => row.id === seatedSession?.tableId) || null;
  const tooBig = Boolean(selectedReservation && mapService?.capacity === "verified" && selectedReservation.partySize > mapService.maxSeats);
  const canSeat = ["booked", "arrived"].includes(selectedReservation?.status) && serviceable(mapService) && !tooBig;
  const liveCovers = currentSeatedCovers(state);
  const pickedLabels = state.tables.filter((row) => joinIds.includes(row.id)).map((row) => row.label);

  dropRef.current = (payload, label) => {
    const table = state.tables.find((row) => row.label === label && !row.removed);
    if (payload.kind === "seat") {
      setSelectedReservationId(payload.reservationId);
      setDrawer(true);
      seatOn(table, payload.reservationId);
    }
    if (payload.kind === "move") transferTo(table, payload.from);
  };

  function beginDrag(event, payload) {
    if (event.button != null && event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY, moved: false };
    function move(next) {
      if (!start.moved && Math.abs(next.clientX - start.x) + Math.abs(next.clientY - start.y) < 8) return;
      start.moved = true;
      const hit = document.elementFromPoint(next.clientX, next.clientY);
      setDrag({ ...payload, x: next.clientX, y: next.clientY, over: hit?.closest?.("[data-label]")?.getAttribute("data-label") || null });
    }
    function up(next) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const hit = document.elementFromPoint(next.clientX, next.clientY);
      const label = hit?.closest?.("[data-label]")?.getAttribute("data-label") || null;
      setDrag(null);
      if (start.moved && label) dropRef.current(payload, label);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function chooseTable(label) {
    setSelectedLabel(label);
    const service = state.tables.find((row) => row.label === label && row.active !== false && !row.removed) || null;
    setSelectedTableId(service ? service.id : null);
    if (mode === "move" && service) {
      transferTo(service);
      setMode(null);
      return;
    }
    if (mode === "join" && service && seatedSession && service.id !== seatedSession.tableId) {
      if (!serviceable(service) || service.floorId !== sessionTable?.floorId) {
        report(service.floorId !== sessionTable?.floorId
          ? "Join tables in the same seating area."
          : `Table ${label} is not open.`);
        return;
      }
      setJoinIds((ids) => (ids.includes(service.id) ? ids.filter((id) => id !== service.id) : [...ids, service.id]));
    }
  }

  async function seatOn(table, reservationId) {
    const reservation = state.reservations.find((row) => row.id === (reservationId || selectedReservation?.id));
    if (!reservation || !["booked", "arrived"].includes(reservation.status)) {
      report("Choose a guest who is waiting for a table.");
      return;
    }
    if (!table) {
      report("That table is not in the service book.");
      return;
    }
    if (!serviceable(table)) {
      report(`Table ${table.label} is ${tableStatusLabel(table.status).toLowerCase()}.`);
      return;
    }
    if (table.capacity === "verified" && reservation.partySize > table.maxSeats) {
      report(`Party of ${reservation.partySize} is larger than table ${table.label}'s ${table.maxSeats} seats.`);
      return;
    }
    const label = guestName(state, reservation.guestId);
    let result = dispatch(
      "assignTable",
      [reservation.id, table.id],
      `${label} is seated on table ${table.label}. The waiter opens the dining session.`,
    );
    if (result && typeof result.then === "function") result = await result;
    if (result.ok) {
      setSelectedReservationId(reservation.id);
      setSelectedTableId(table.id);
      setSelectedLabel(table.label);
      setDrawer(true);
    }
  }

  function transferTo(destination, fromLabel) {
    const from = fromLabel ? state.tables.find((row) => row.label === fromLabel) : sessionTable;
    const session = state.sessions.find((row) => row.status === "open" && (row.id === from?.sessionId || row.tableId === from?.id))
      || (!fromLabel ? seatedSession : null);
    if (!session) {
      report("Open the dining session before moving this party.");
      return;
    }
    if (!destination || destination.id === session.tableId) {
      report("Choose a different open table.");
      return;
    }
    if (!serviceable(destination)) {
      report(`Table ${destination.label} is not open.`);
      return;
    }
    const reservation = state.reservations.find((row) => row.id === session.reservationId);
    if (destination.capacity === "verified" && reservation && reservation.partySize > destination.maxSeats) {
      report(`Party of ${reservation.partySize} is larger than table ${destination.label}'s ${destination.maxSeats} seats.`);
      return;
    }
    dispatch("transferTable", [session.id, destination.id], `Session moved to table ${destination.label}.`);
    setSelectedLabel(destination.label);
    setSelectedTableId(destination.id);
  }

  function move() {
    if (!seatedSession) return;
    if (serviceable(mapService) && mapService.id !== seatedSession.tableId) {
      transferTo(mapService);
      return;
    }
    setMode("move");
    report("Choose the destination table.");
  }

  function join() {
    if (!seatedSession || !sessionTable) return;
    const selectedExtra = serviceable(mapService) && mapService.id !== seatedSession.tableId ? mapService : null;
    if (mode !== "join" && !selectedExtra && !joinIds.length) {
      setMode("join");
      report("Select the open tables to join.");
      return;
    }
    const ids = [...new Set([...(mode === "join" ? joinIds : []), ...(selectedExtra ? [selectedExtra.id] : [])])];
    const tables = ids.map((id) => state.tables.find((row) => row.id === id));
    if (!tables.length || tables.some((table) => !serviceable(table) || table.floorId !== sessionTable.floorId)) {
      report("Join open tables in the same seating area.");
      return;
    }
    const names = tables.map((table) => table.label).join(", ");
    dispatch("combineTables", [seatedSession.id, ids], `Joined table ${names} with this session.`);
    setMode(null);
    setJoinIds([]);
  }

  function rememberCard(reservationId) {
    setScreen((prev) => ({
      ...prev,
      walkCards: {
        ...(prev.walkCards || {}),
        [reservationId]: {
          phone: phone.trim(),
          area,
          duration,
          tags,
          perk,
          note: note.trim(),
          shiftId,
        },
      },
    }));
  }

  function resetCard() {
    setPhone("");
    setArea("indoor");
    setDuration("90");
    setTags([]);
    setPerk("");
    setNote("");
  }

  function openDraft(kind) {
    setDraft(kind);
    setName("");
    resetCard();
  }

  function submitDraft(event) {
    event.preventDefault();
    saveWalk("arrived");
  }

  async function saveWalk(kind) {
    const party = Number(partySize);
    if (!Number.isFinite(party) || party < 1) {
      report("Enter a party size of at least 1.");
      return;
    }
    const guest = name.trim();
    if (kind === "wait") {
      if (!guest) {
        report("Enter a name and party size. This list is only on the screen.");
        return;
      }
      if (state.developmentDatabase) {
        let saved = dispatch("addWaitlist", { guestName: guest, partySize: party }, "Added to the local development waitlist. The wait is an estimate, not a guaranteed table.");
        if (saved && typeof saved.then === "function") saved = await saved;
        if (!saved?.ok) return;
        setName("");
        resetCard();
        setDraft(null);
        setWaitOpen(true);
        return;
      }
      setScreen((prev) => ({
        ...prev,
        waitSeq: prev.waitSeq + 1,
        waitlist: [...prev.waitlist, { id: `screen-wait-${prev.waitSeq}`, name: guest, partySize: party }],
      }));
      setName("");
      resetCard();
      setDraft(null);
      setWaitOpen(true);
      report("Added to the screen-only waiting list. This is not a reservation.");
      return;
    }
    const walking = draft === "walk";
    const when = walking ? formatServiceTime(new Date(currentTime)) : time;
    const date = walking ? today : serviceDate;
    let result = dispatch(
      "reserve",
      { guestName: guest, partySize: party, time: when, date, phone: phone.trim() || null },
      walking
        ? (state.developmentDatabase ? "Walk-in saved in the local development database." : "Walk-in saved.")
        : (state.developmentDatabase ? "Reservation saved in the local development database." : "Reservation saved in this simulation only."),
    );
    if (result && typeof result.then === "function") result = await result;
    if (!result?.ok) return;
    rememberCard(result.reservation.id);
    setSelectedReservationId(result.reservation.id);
    setProfileId(result.guest.id);
    setName("");
    resetCard();
    setDraft(null);
    setDrawer(true);
    if (!walking) return;
    const arrived = dispatch("markArrived", result.reservation.id, `${result.guest.name} is in Arrived. Choose a table when you are ready to seat them.`);
    if (arrived && typeof arrived.then === "function") await arrived;
    if (kind === "seat") {
      const table = mapService;
      const fits = !table || table.capacity !== "verified" || party <= table.maxSeats;
      if (serviceable(table) && fits) seatOn(table, result.reservation.id);
      else report(`${result.guest.name} is in Arrived. Choose an open table to seat them now.`);
    }
  }

  async function addWait(event) {
    event.preventDefault();
    const nextName = waitName.trim();
    const party = Number(waitParty);
    if (!nextName || !Number.isFinite(party) || party < 1) {
      report("Enter a name and party size.");
      return;
    }
    if (state.developmentDatabase) {
      let saved = dispatch("addWaitlist", { guestName: nextName, partySize: party }, "Added to the local development waitlist. The wait is an estimate, not a guaranteed table.");
      if (saved && typeof saved.then === "function") saved = await saved;
      if (saved?.ok) setWaitName("");
      return;
    }
    setScreen((prev) => ({
      ...prev,
      waitSeq: prev.waitSeq + 1,
      waitlist: [...prev.waitlist, { id: `screen-wait-${prev.waitSeq}`, name: nextName, partySize: party }],
    }));
    setWaitName("");
    report("Added to the screen-only waiting list. This is not a reservation.");
  }

  function bookWait(entry) {
    const result = dispatch(
      "reserve",
      { guestName: entry.name, partySize: entry.partySize, time, date: serviceDate },
      "Waiting list name booked as a reservation.",
    );
    if (!result.ok) return;
    setScreen((prev) => ({ ...prev, waitlist: prev.waitlist.filter((row) => row.id !== entry.id) }));
    setSelectedReservationId(result.reservation.id);
    setProfileId(result.guest.id);
    setDrawer(true);
  }

  function groupIsOpen(id, rows) {
    if (rows.some((row) => row.id === selectedReservationId)) return true;
    if (id === "left" || id === "cancelled" || id === "no_show") return openGroups[id] === true;
    return openGroups[id] !== false;
  }

  const walkCard = selectedReservation ? (screen.walkCards || {})[selectedReservation.id] || null : null;
  const areaName = AREAS.find((row) => row[0] === walkCard?.area)?.[1] || null;
  const seating = selectedReservation && ["booked", "arrived"].includes(selectedReservation.status)
    ? recommendTables({
      tables: state.tables,
      reservations: state.reservations.filter((row) => row.id !== selectedReservation.id),
      partySize: selectedReservation.partySize,
      section: areaName ? walkCard.area : null,
    })
    : null;

  return (
    <div className="desk">
      <header className="desk-top">
        <label className="desk-search">
          Search guests
          <input value={guestQuery} onChange={(event) => setGuestQuery(event.target.value)} placeholder="Search reservations" />
        </label>
        <div className="desk-date">
          <button type="button" onClick={() => setServiceDate(shiftServiceDate(serviceDate, -1))} aria-label="Previous date">‹</button>
          <label>
            Service date
            <input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} />
          </label>
          <strong>{formatDeskDate(serviceDate)}</strong>
          <button type="button" onClick={() => setServiceDate(shiftServiceDate(serviceDate, 1))} aria-label="Next date">›</button>
        </div>
        <div className="desk-tools">
          <div className="desk-shifts" role="group" aria-label="Shift">
            {shifts.map((row) => (
              <button
                key={row.id}
                type="button"
                aria-pressed={shiftId === row.id}
                onClick={() => setShiftId(row.id)}
              >
                {row.label}
              </button>
            ))}
          </div>
          <button type="button" className="desk-ghost-btn" onClick={() => openDraft("walk")}>Walk in</button>
          <button type="button" className="svc-primary" onClick={() => openDraft("book")}>Add reservation</button>
        </div>
      </header>
      <div className="desk-body">
        <aside className="desk-list" aria-label="Reservations">
          {GROUPS.map(([id, label, match]) => {
            const rows = visibleReservations.filter(match);
            const covers = coversOf(rows);
            const open = groupIsOpen(id, rows);
            return (
              <section key={id}>
                <button
                  type="button"
                  className="desk-group"
                  aria-expanded={open}
                  onClick={() => setOpenGroups((prev) => ({ ...prev, [id]: !open }))}
                >
                  <span className="desk-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
                  <span>{label}</span>
                  <span className="desk-count">{rows.length}</span>
                  <span className="desk-covers">{id === "seated" && !rows.length ? "None seated" : covers == null ? "Covers unavailable" : `${covers} covers`}</span>
                </button>
                {open && (
                  <ul>
                    {rows.map((reservation) => {
                      const table = state.tables.find((row) => row.id === reservation.tableId);
                      const guest = guestName(state, reservation.guestId);
                      return (
                        <li key={reservation.id}>
                          <button
                            type="button"
                            className="desk-row"
                            aria-label={`${guest} · ${reservation.partySize} · ${statusLabel(reservation.status)}`}
                            aria-pressed={selectedReservationId === reservation.id}
                            onClick={() => {
                              setSelectedReservationId(reservation.id);
                              setProfileId(reservation.guestId);
                              setDrawer(true);
                            }}
                            onPointerDown={(event) => {
                              if (["booked", "arrived"].includes(reservation.status)) {
                                beginDrag(event, { kind: "seat", reservationId: reservation.id });
                              }
                            }}
                          >
                            <span className="desk-time">{reservation.time}</span>
                            <strong>{guest}</strong>
                            <span className="desk-party">{reservation.partySize}</span>
                            <span className="desk-table">{table ? table.label : "—"}</span>
                            <span className={`desk-pill desk-pill-${reservation.status}`}>{statusLabel(reservation.status)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
          <section aria-label="Screen-only waiting list">
            <button type="button" className="desk-group" aria-expanded={waitOpen} onClick={() => setWaitOpen((value) => !value)}>
              <span className="desk-caret" aria-hidden="true">{waitOpen ? "▾" : "▸"}</span>
              <span>Waiting list</span>
              <span className="desk-count">{(state.developmentDatabase ? state.waitlist || [] : screen.waitlist).length}</span>
              <span className="desk-covers">{coversOf((state.developmentDatabase ? state.waitlist || [] : screen.waitlist).map((row) => ({ partySize: row.partySize }))) ?? "Covers unavailable"} covers</span>
            </button>
            {waitOpen && (
              <div>
                <p>{state.developmentDatabase ? "Local development waitlist. Estimate only, not a guaranteed table." : "Screen only · not a reservation"}</p>
                <form onSubmit={addWait}>
                  <label>
                    Waiting list name
                    <input value={waitName} onChange={(event) => setWaitName(event.target.value)} />
                  </label>
                  <label>
                    Waiting list party size
                    <input inputMode="numeric" value={waitParty} onChange={(event) => setWaitParty(event.target.value)} />
                  </label>
                  <button type="submit">Add to waiting list</button>
                </form>
                <ul>
                  {(state.developmentDatabase ? state.waitlist || [] : screen.waitlist).map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.name} · party of {entry.partySize}</span>
                      {state.developmentDatabase ? (
                        <>
                          <button type="button" disabled={entry.status !== "waiting"} onClick={() => dispatch("bookWaitlist", { id: entry.id, date: serviceDate, time: "19:30" }, `${entry.name} is booked from the waitlist. The table is not guaranteed until seated.`)}>Book from waiting list</button>
                          <button type="button" disabled={entry.status !== "waiting" || mapService?.status !== "open"} onClick={() => dispatch("seatWaitlist", { id: entry.id, tableId: mapService.id }, `${entry.name} is seated from the waitlist.`)}>Seat on selected table</button>
                          <button type="button" disabled={entry.status !== "waiting"} onClick={() => dispatch("cancelWaitlist", { id: entry.id }, `${entry.name} was removed from the waitlist.`)}>Cancel wait</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => bookWait(entry)}>Book from waiting list</button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section aria-label="Guests on this branch">
            {state.guests.length === 0 && <p>No guests yet.</p>}
            {state.guests.length > 0 && guests.length === 0 && <p>No matching guest on this branch.</p>}
            <ul>
              {guests.map((guest) => (
                <li key={guest.id}>
                  <button type="button" onClick={() => { setProfileId(guest.id); setDrawer(true); }}>{guest.name}</button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
        <section className="desk-floor" aria-label="Restaurant floor">
          <div className="desk-floor-tools">
            <button type="button" disabled={!canSeat} onClick={() => seatOn(mapService)}>Seat on selected table</button>
            <button type="button" disabled={!seatedSession} onClick={move}>Move</button>
            <button type="button" disabled={!seatedSession} onClick={join}>Join tables</button>
            {state.developmentDatabase && mapService?.status === "cleaning" && (
              <button type="button" onClick={() => dispatch("setTableHold", [mapService.id, null], `Table ${mapService.label} is available again.`)}>Cleaning done</button>
            )}
            {state.reservations.some((row) => row.status === "seated") && (
              <button type="button" onClick={() => onRole("waiter")}>Continue to waiter</button>
            )}
          </div>
          {mode && <p className="desk-mode">{mode === "move" ? "Choose the destination table." : "Select open tables, then join them."}</p>}
          {khobar ? (
            <FloorCanvas
              state={state}
              tables={hostTables(layout, state)}
              selectedLabel={activeLabel}
              hotLabel={drag?.over || null}
              pickedLabels={pickedLabels}
              initialFit
              onSelect={chooseTable}
              onPullGuest={(label, x, y) => {
                const hit = document.elementFromPoint(x, y);
                const dest = hit?.closest?.("[data-label]")?.getAttribute("data-label");
                if (dest) dropRef.current({ kind: "move", from: label }, dest);
              }}
            />
          ) : (
            <p>This branch uses its own service tables. The Khobar floor stays on Khobar.</p>
          )}
          <p className="kh-legend">
            <span>Available</span><span>Seated</span><span>Combined</span>
            <span>Indoor</span><span>Outdoor</span><span>Waiting area</span><span>Bar</span><span>Kitchen</span>
          </p>
          {liveCovers.parties > 0 && <p className="svc-sr">{liveCovers.covers} covers seated</p>}
        </section>
      </div>
      {draft && (
        <div className="desk-shade">
          <div className="desk-modal" role="dialog" aria-label={draft === "walk" ? "Walk in" : "Add reservation"}>
            <form onSubmit={submitDraft}>
              <header className="desk-modal-head">
                <h2>{draft === "walk" ? "Add walk-in" : "Add reservation"}</h2>
                <button type="button" className="desk-icon" onClick={() => setDraft(null)} aria-label="Dismiss">×</button>
              </header>
              <p className="desk-field-label">Party size</p>
              <div className="desk-pills" role="group" aria-label="Quick party size">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].map((size) => (
                  <button key={size} type="button" aria-pressed={partySize === size} onClick={() => setPartySize(size)}>{size}</button>
                ))}
                <button type="button" aria-pressed={Number(partySize) > 12} onClick={() => setPartySize("13")}>12+</button>
              </div>
              <label>
                Guest name
                <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Optional for a walk-in" />
              </label>
              <label>
                Party size
                <input inputMode="numeric" value={partySize} onChange={(event) => setPartySize(event.target.value)} />
              </label>
              {draft === "walk" && (
                <>
                  <label>
                    Phone
                    <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="Optional" />
                  </label>
                  <div className="desk-split">
                    <label>
                      Area
                      <select value={area} onChange={(event) => setArea(event.target.value)}>
                        {AREAS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                    </label>
                    <label>
                      Shift
                      <select aria-label="Walk-in shift" value={shiftId} onChange={(event) => setShiftId(event.target.value)}>
                        {shifts.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="desk-field-label">Duration</p>
                  <div className="desk-pills" role="group" aria-label="Duration">
                    {DURATIONS.map((minutes) => (
                      <button key={minutes} type="button" aria-pressed={duration === minutes} onClick={() => setDuration(minutes)}>{minutes} min</button>
                    ))}
                  </div>
                  <p className="desk-field-label">Tags</p>
                  <div className="desk-pills" role="group" aria-label="Tags">
                    {TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={tags.includes(tag)}
                        onClick={() => setTags((current) => (current.includes(tag) ? current.filter((row) => row !== tag) : [...current, tag]))}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <p className="desk-field-label">Perks</p>
                  <div className="desk-pills" role="group" aria-label="Perks">
                    {PERKS.map((item) => (
                      <button key={item} type="button" aria-pressed={perk === item} onClick={() => setPerk((current) => (current === item ? "" : item))}>{item}</button>
                    ))}
                  </div>
                  <label>
                    Notes
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
                  </label>
                  <p className="desk-screen-note">Duration, tags, notes, and perks stay on this screen. A phone number is stored on the guest in this browser simulation. This is not a production database.</p>
                </>
              )}
              {draft === "book" && (
                <label>
                  Time
                  <input value={time} onChange={(event) => setTime(event.target.value)} />
                </label>
              )}
              <div className="desk-modal-actions">
                {draft === "walk" ? (
                  <>
                    <button type="button" className="svc-primary" onClick={() => saveWalk("seat")}>Seat now</button>
                    <button type="submit">Add walk-in</button>
                    <button type="button" onClick={() => saveWalk("wait")}>Add to waitlist</button>
                  </>
                ) : (
                  <button type="submit" className="svc-primary">Create reservation</button>
                )}
                <button type="button" onClick={() => setDraft(null)}>Close</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {drawer && (selectedReservation || history?.ok) && (
        <aside className="desk-drawer" role="region" aria-label="Guest profile">
          <header className="desk-drawer-head">
            <div>
              <p className="desk-kicker">{selectedReservation ? statusLabel(selectedReservation.status) : "Guest"}</p>
              <h2>{selectedReservation ? guestName(state, selectedReservation.guestId) : history?.profile?.name}</h2>
            </div>
            <button type="button" className="desk-icon" onClick={() => setDrawer(false)} aria-label="Close details">×</button>
          </header>
          {selectedReservation && (
            <>
              <dl className="desk-facts">
                <div><dt>Time</dt><dd>{selectedReservation.time}</dd></div>
                <div><dt>Date</dt><dd>{selectedReservation.date || serviceDate}</dd></div>
                <div><dt>Covers</dt><dd>{selectedReservation.partySize}</dd></div>
                <div><dt>Table</dt><dd>{assignedTable(state, selectedReservation) ? assignedTable(state, selectedReservation).label : "No table"}</dd></div>
                <div><dt>Area</dt><dd>{assignedTable(state, selectedReservation)?.floorId || areaName || "Area follows the table"}</dd></div>
                <div><dt>Status</dt><dd>{statusLabel(selectedReservation.status)}</dd></div>
              </dl>
              <p className="svc-sr">{selectedReservation.time} · {selectedReservation.date || serviceDate}</p>
              <p className="svc-sr">Party of {selectedReservation.partySize} · {statusLabel(selectedReservation.status)}</p>
              <p className="svc-sr">{assignedTable(state, selectedReservation) ? `Table ${assignedTable(state, selectedReservation).label}` : "No table"}</p>
              {mapService && selectedReservation && mapService.capacity !== "verified" && ["booked", "arrived"].includes(selectedReservation.status) && (
                <p>Capacity is unverified. No seat count is assumed.</p>
              )}
              {tooBig && (
                <p>Party of {selectedReservation.partySize} is larger than this table&apos;s {mapService.maxSeats} seats.</p>
              )}
              <p>Party size is set when the reservation is created. Cover changes are not a separate action.</p>
              {seating?.ok && (
                <section aria-label="Suggested tables">
                  <h3>Suggested tables</h3>
                  {seating.recommendations.length === 0 && <p>No open table has a verified capacity that fits this party. No seat count is assumed.</p>}
                  {seating.recommendations.slice(0, 3).map((row) => (
                    <button key={row.tableId} type="button" onClick={() => chooseTable(row.label)}>
                      Suggest {row.label}. {row.because}
                    </button>
                  ))}
                  {seating.skippedUnverified > 0 && <p>{seating.skippedUnverified} open tables have unverified capacity and are not recommended.</p>}
                </section>
              )}
              {walkCard && (
                <div className="desk-card-note">
                  <p>On this screen only.</p>
                  {walkCard.phone ? <p>Phone {walkCard.phone}</p> : null}
                  {walkCard.duration ? <p>Duration {walkCard.duration} min</p> : null}
                  {walkCard.tags?.length ? <p>Tags {walkCard.tags.join(", ")}</p> : null}
                  {walkCard.perk ? <p>Perk {walkCard.perk}</p> : null}
                  {walkCard.note ? <p>Notes {walkCard.note}</p> : null}
                </div>
              )}
              <div className="desk-drawer-actions">
                <button type="button" disabled={selectedReservation.status !== "booked"} onClick={() => dispatch("markArrived", selectedReservation.id, "Guest arrived. Choose a table to seat them.")}>Mark arrived</button>
                <button type="button" disabled={!canSeat} onClick={() => seatOn(mapService)}>Seat this party</button>
                <button type="button" disabled={!seatedSession} onClick={move}>Move table</button>
                <button type="button" disabled={!seatedSession} onClick={join}>Join table</button>
                <button type="button" disabled={!["booked", "arrived"].includes(selectedReservation.status)} onClick={() => dispatch("cancelReservation", selectedReservation.id, "Reservation cancelled.")}>Cancel reservation</button>
                <button type="button" disabled={!["booked", "arrived"].includes(selectedReservation.status)} onClick={() => dispatch("markNoShow", selectedReservation.id, "Reservation marked as a no-show.")}>Mark no-show</button>
                <button type="button" disabled>Change covers</button>
              </div>
            </>
          )}
          {!history?.ok && <p>Select a guest.</p>}
          {history?.ok && (
            <section>
              <h3>Visits</h3>
              <p>{history.profile.name} · {history.profile.branchId}</p>
              {profileGuest?.phone ? <p>Phone {profileGuest.phone}</p> : null}
              <p>{history.profile.visits ? `${history.profile.visits} closed visits on this branch` : "No closed visits on this branch."}</p>
            </section>
          )}
        </aside>
      )}
      {drag && (
        <div className="desk-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.kind === "move" ? `Move table ${drag.from}` : "Seat guest"}
        </div>
      )}
      {khobar && state.tables.some((table) => !KHOBAR_TABLES.some((row) => row.label === table.label)) && (
        <p className="svc-sr">A service table is outside the photographed floor.</p>
      )}
    </div>
  );
}

function formatDeskDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return value || "Date unavailable";
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function matchesShift(reservation, shift) {
  if (["arrived", "seated"].includes(reservation.status)) return true;
  if (!shift?.start || !shift?.end) return true;
  return reservation.time >= shift.start && reservation.time <= shift.end;
}

function matchesQuery(state, reservation, query) {
  if (!query) return true;
  return guestName(state, reservation.guestId).toLowerCase().includes(query);
}

function assignedTable(state, reservation) {
  return state.tables.find((row) => row.id === reservation.tableId) || null;
}
