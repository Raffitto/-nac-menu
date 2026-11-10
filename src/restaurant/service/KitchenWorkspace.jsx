import React, { useState } from "react";
import { orderLineSummary, stationLabel } from "../waiter/posActions";
import {
  dedupeTickets,
  formatElapsed,
  guestName,
  KITCHEN_COLUMNS,
  orderForSession,
  statusLabel,
  ticketDelay,
} from "./serviceShared";

function ticketTable(state, ticket) {
  const session = state.sessions.find((row) => row.id === ticket.sessionId) || null;
  const table = session ? state.tables.find((row) => row.id === session.tableId) : null;
  const order = state.orders.find((row) => row.id === ticket.orderId) || orderForSession(state, ticket.sessionId);
  return { session, table, order };
}

function viewCode(station) {
  if (station === "pass" || station === "kitchen") return "kitchen";
  return station || "";
}

export default function KitchenWorkspace({ restaurant, dispatch, screen, currentTime, onRole }) {
  const state = restaurant.state;
  const { tickets, duplicates } = dedupeTickets(state.tickets);
  const ready = tickets.some((ticket) => ticket.status === "ready");
  const views = new Map([["kitchen", "Kitchen"]]);
  (state.stations || []).filter((station) => station.active !== false).forEach((station) => {
    views.set(viewCode(station.code), station.name);
  });
  tickets.forEach((ticket) => {
    const code = viewCode(ticket.station);
    if (code && !views.has(code)) views.set(code, ticket.stationName || stationLabel(code));
  });
  if (!views.has("bar")) views.set("bar", "Bar");
  const [stationCode, setStationCode] = useState("kitchen");
  const selected = views.has(stationCode) ? stationCode : "kitchen";
  const visibleTickets = tickets.filter((ticket) => viewCode(ticket.station) === selected);

  return (
    <div className="svc-kitchen">
      <header className="svc-card">
        <h2>Kitchen display</h2>
        <p className="svc-gap">A ticket appears on a station only when that station was saved with the item. Sending the same item again does not create a second charge.</p>
        <div className="svc-stations" role="group" aria-label="Preparation stations">
          {[...views.entries()].map(([code, name]) => (
            <button key={code} type="button" aria-pressed={selected === code} onClick={() => setStationCode(code)}>{name}</button>
          ))}
        </div>
        <p className="svc-gap">Items without a configured station stay off this screen.</p>
        {duplicates > 0 && (
          <p role="alert">{duplicates} duplicate ticket ids were hidden. The service keeps one ticket per order.</p>
        )}
        {ready && <button type="button" onClick={() => onRole("waiter")}>Continue to waiter</button>}
      </header>
      <div className="svc-kds" data-testid="kitchen-board">
        {KITCHEN_COLUMNS.map((column) => {
          const rows = visibleTickets.filter((ticket) => ticket.status === column.id);
          return (
            <section key={column.id} aria-label={`${column.label} tickets`}>
              <h3>{column.label}</h3>
              <p className="svc-gap">{column.hint}</p>
              {rows.length === 0 && <p>No {column.label.toLowerCase()} tickets.</p>}
              {rows.map((ticket) => {
                const { session, table, order } = ticketTable(state, ticket);
                const items = order?.items || [];
                const clock = screen.clocks[ticket.id];
                const delay = items.length && clock
                  ? ticketDelay(ticket.status, clock.since, currentTime)
                  : { delayed: false, elapsedMs: clock ? Math.max(0, currentTime - clock.since) : 0 };
                const seen = clock ? new Date(clock.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
                return (
                  <article
                    key={ticket.id}
                    className="svc-ticket"
                    data-testid={`kitchen-ticket-${ticket.orderId}`}
                    data-status={ticket.status}
                    data-delayed={delay.delayed ? "true" : "false"}
                  >
                    <p className="svc-table-label">{table ? `Table ${table.label}` : "Table unavailable"}</p>
                    <p>{session ? guestName(state, session.guestId) : "Guest unavailable"}</p>
                    <p>
                      <span className="svc-status" data-status={ticket.status}>{statusLabel(ticket.status)}</span>
                      {delay.delayed && <span className="svc-status" data-status="delayed">Delayed</span>}
                    </p>
                    <p data-testid={`ticket-timer-${ticket.orderId}`}>
                      {seen ? `Seen at ${seen} · ${formatElapsed(delay.elapsedMs)}` : "Timer starts when this screen sees the ticket."}
                    </p>
                    {items.length === 0 && <p>Waiting for items.</p>}
                    <ul className="svc-lines">
                      {items.filter((item) => item.routing === "unassigned" ? false : (!item.station || viewCode(item.station) === viewCode(ticket.station))).map((item) => (
                        <li key={item.id}>
                          <span>{item.name}</span>
                          <span className="svc-status" data-status={item.status}>{statusLabel(item.status)}</span>
                          {(() => {
                            const summary = orderLineSummary(item);
                            return (
                              <>
                                {summary.preparations.map((modifier) => <span key={modifier.id}>Preparation: {modifier.name}</span>)}
                                {summary.addons.map((modifier) => <span key={modifier.id}>Add-on: {modifier.name}</span>)}
                                {summary.instructions ? <span>Instruction: {summary.instructions}</span> : null}
                                {item.allergyAlert ? <span>Allergy: {item.allergyAlert}</span> : null}
                              </>
                            );
                          })()}
                          {item.statusAt ? <span>Status recorded {new Date(item.statusAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> : null}
                          {item.status !== "cancelled" && (
                            <span className="svc-actions">
                              <button type="button" onClick={() => dispatch("setItemStatus", [item.id, "preparing"], "Item is preparing.")}>Prepare item</button>
                              <button type="button" onClick={() => dispatch("setItemStatus", [item.id, "ready"], "Item is ready.")}>Item ready</button>
                              <button type="button" onClick={() => dispatch("setItemStatus", [item.id, "cancelled"], "Item cancellation requested.")}>Cancel item</button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="svc-gap">Each item keeps its own status. Cancelling an item needs a manager. Nothing is sent to a printer.</p>
                    <div className="svc-actions">
                      <button
                        type="button"
                        className="svc-primary"
                        disabled={!items.length || (ticket.status !== "queued" && ticket.status !== "accepted")}
                        onClick={() => dispatch("setKitchenStatus", state.developmentDatabase ? [ticket.orderId, "preparing", ticket.station] : [ticket.orderId, "preparing"], "Ticket is preparing.")}
                      >
                        Start preparing
                      </button>
                      <button
                        type="button"
                        disabled={!items.length || ticket.status !== "queued"}
                        onClick={() => dispatch("setKitchenStatus", state.developmentDatabase ? [ticket.orderId, "accepted", ticket.station] : [ticket.orderId, "accepted"], "Ticket accepted.")}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={!items.length || ticket.status === "ready" || ticket.status === "served"}
                        onClick={() => dispatch("setKitchenStatus", state.developmentDatabase ? [ticket.orderId, "ready", ticket.station] : [ticket.orderId, "ready"], "Ticket is ready for the waiter.")}
                      >
                        Mark ready
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
