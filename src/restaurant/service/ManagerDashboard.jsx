import React from "react";

export default function ManagerDashboard({ restaurant }) {
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
    <section className="svc-card" aria-label="Live management">
      <h2>Live floor</h2>
      <p className="svc-gap">Counts come from this branch in the local development database. Collected payments are not shown. Tax is not configured.</p>
      <ul className="svc-list">
        {figures.map(([label, value]) => (
          <li key={label}>{label}: {value}</li>
        ))}
      </ul>
    </section>
  );
}
