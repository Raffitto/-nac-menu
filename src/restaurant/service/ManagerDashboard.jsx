import React, { useState } from "react";

export default function ManagerDashboard({ restaurant, orderMenu = [], dispatch = null }) {
  const state = restaurant.state;
  const tables = state.tables || [];
  const occupied = tables.filter((table) => table.status === "occupied" || table.status === "assigned");
  const available = tables.filter((table) => table.status === "open" && !table.hold);
  const cleaning = tables.filter((table) => table.hold === "cleaning" || table.status === "cleaning");
  const openSessions = (state.sessions || []).filter((session) => session.status === "open");
  const reservations = state.reservations || [];
  const arrivals = reservations.filter((row) => row.status === "arrived");
  const seated = reservations.filter((row) => row.status === "seated");
  const waiting = (state.waitlist || []).filter((row) => row.status === "waiting");
  const tickets = state.tickets || [];
  const kitchenOpen = tickets.filter((ticket) => ticket.status !== "served");
  const awaitingService = tickets.filter((ticket) => ticket.status === "ready");
  const unpaid = (state.bills || []).filter((bill) => bill.status === "open" && bill.paid !== true);
  const closedVisits = (state.visits || []).filter((visit) => visit.status === "completed");
  const cancelledOnOpen = (state.orders || [])
    .filter((order) => openSessions.some((session) => session.id === order.sessionId))
    .flatMap((order) => order.items || [])
    .filter((item) => item.status === "cancelled");

  const figures = [
    ["Occupied tables", occupied.length],
    ["Available tables", available.length],
    ["Cleaning tables", cleaning.length],
    ["Open dining sessions", openSessions.length],
    ["Reservations", reservations.length],
    ["Arrivals", arrivals.length],
    ["Seated reservations", seated.length],
    ["Waiting list", waiting.length],
    ["Kitchen tickets", kitchenOpen.length],
    ["Ready for service", awaitingService.length],
    ["Open unpaid bills", unpaid.length],
    ["Closed sessions", closedVisits.length],
    ["Voided items on open sessions", cancelledOnOpen.length],
    ["Guest orders waiting for staff", state.guestOrdersPending ?? 0],
  ];

  return (
    <>
    <StationAssignments restaurant={restaurant} orderMenu={orderMenu} dispatch={dispatch} />
    <section className="svc-card" aria-label="Live management">
      <h2>Live floor</h2>
      <p className="svc-gap">Counts come from this branch in the local development database. Collected payments are not shown. Tax is not configured.</p>
      <ul className="svc-list">
        {figures.map(([label, value]) => (
          <li key={label}>{label}: {value}</li>
        ))}
      </ul>
    </section>
    </>
  );
}

function StationAssignments({ restaurant, orderMenu, dispatch }) {
  const stations = restaurant.state.stations || [];
  const assignments = restaurant.state.itemStations || [];
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState("");
  const [stationId, setStationId] = useState(stations[0]?.id || "");
  const catalogue = Array.isArray(orderMenu) ? orderMenu : (orderMenu?.lines || []);
  const choices = catalogue
    .filter((line) => String(line.name || "").toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 20);
  if (!dispatch) return null;

  return (
    <section className="svc-card" aria-label="Preparation stations">
      <h2>Preparation stations</h2>
      <p className="svc-gap">Assignments are explicit for this branch. A menu category does not choose a station. Nothing is sent to a printer.</p>
      {stations.length === 0 && <p>No preparation station is configured.</p>}
      <ul className="svc-list">
        {stations.map((station) => <li key={station.id}>{station.name} · {station.code}</li>)}
      </ul>
      <form onSubmit={(event) => {
        event.preventDefault();
        dispatch("createStation", { code, name }, "Station saved for this branch.");
      }}>
        <label>Station name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Station code<input value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <button type="submit">Save station</button>
      </form>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!itemId || !stationId) return;
        dispatch("assignItemStation", { itemId, stationId }, "Product station saved. Earlier orders keep the station they were submitted with.");
      }}>
        <label>Find product<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>Product
          <select value={itemId} onChange={(event) => setItemId(event.target.value)}>
            <option value="">Select a product</option>
            {choices.map((line) => <option key={line.itemId} value={line.itemId}>{line.name}</option>)}
          </select>
        </label>
        <label>Station
          <select value={stationId} onChange={(event) => setStationId(event.target.value)}>
            <option value="">Select a station</option>
            {stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
          </select>
        </label>
        <button type="submit">Assign product</button>
      </form>
      {assignments.length > 0 && (
        <ul className="svc-list">
          {assignments.map((row) => <li key={`${row.catalogueItemId}:${row.stationId}`}>{row.catalogueItemId} · {row.stationName}</li>)}
        </ul>
      )}
    </section>
  );
}
