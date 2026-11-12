import React, { useState } from "react";
import FloorPlan from "./FloorPlan";
import {
  guestName,
  money,
  openSessionForTable,
  orderForSession,
  reservationByTable,
  statusLabel,
  tableStatusLabel,
  ticketForOrder,
} from "./serviceShared";

function CatalogueNotes({ menu }) {
  return (
    <>
      {menu.rejected === 1 && <p>1 catalogue line is incomplete and hidden.</p>}
      {menu.rejected > 1 && <p>{menu.rejected} catalogue lines are incomplete and hidden.</p>}
      {menu.unavailable === 1 && <p>1 catalogue line is unavailable.</p>}
      {menu.unavailable > 1 && <p>{menu.unavailable} catalogue lines are unavailable.</p>}
    </>
  );
}

export default function WaiterWorkspace({ restaurant, dispatch, report, screen, setScreen, menu, onRole }) {
  const state = restaurant.state;
  const [selectedId, setSelectedId] = useState(null);
  const [chosen, setChosen] = useState({});
  const [drafts, setDrafts] = useState({});
  const selected = state.tables.find((table) => table.id === selectedId)
    || state.tables.find((table) => table.status !== "open")
    || state.tables[0]
    || null;
  const reservation = selected ? reservationByTable(state, selected.id) : null;
  const session = selected ? openSessionForTable(state, selected.id) : null;
  const order = session ? orderForSession(state, session.id) : null;
  const ticket = order ? ticketForOrder(state, order.id) : null;
  const canOpen = Boolean(selected && reservation && !session);
  const running = order && order.items.every((item) => Number.isFinite(item.price))
    ? order.items.reduce((sum, item) => sum + item.price, 0)
    : null;

  function toggleModifier(itemId, modifierId) {
    setChosen((prev) => {
      const current = prev[itemId] || [];
      const next = current.includes(modifierId)
        ? current.filter((id) => id !== modifierId)
        : [...current, modifierId];
      return { ...prev, [itemId]: next };
    });
  }

  function send(line) {
    if (!session) return;
    const modifierIds = chosen[line.itemId] || [];
    const note = (drafts[line.itemId] || "").trim();
    const result = dispatch(
      "addItem",
      [session.id, { itemId: line.itemId, modifierIds, instructions: note }],
      order?.items?.length
        ? `${line.name} added to the open order. The kitchen keeps the same ticket.`
        : `${line.name} sent on the kitchen ticket.`,
    );
    if (!result.ok || !note) return;
    setDrafts((prev) => ({ ...prev, [line.itemId]: "" }));
  }

  function requestBill() {
    if (!session) return;
    setScreen((prev) => ({ ...prev, billRequests: { ...prev.billRequests, [session.id]: true } }));
    report("Bill requested on this screen. The cashier opens the bill. No bill was created yet.");
  }

  return (
    <div className="svc-waiter">
      <header className="svc-card">
        <h2>Tables</h2>
        <p className="svc-gap">One dining session owns one order and one kitchen ticket.</p>
        <ul className="svc-table-switch">
          {state.tables.map((table) => (
            <li key={table.id}>
              <button type="button" aria-pressed={selected?.id === table.id} onClick={() => setSelectedId(table.id)}>
                {table.label} · {tableStatusLabel(table.status)}
              </button>
            </li>
          ))}
        </ul>
      </header>
      {!selected && <p className="svc-card">No tables are in service for this branch.</p>}
      {selected && (
        <section className="svc-card" aria-label={`Table ${selected.label}`}>
          <p className="svc-table-label">Table {selected.label}</p>
          <p>
            <span className="svc-status" data-status={selected.status}>{tableStatusLabel(selected.status)}</span>
            {" · "}{selected.capacity === "verified" && Number.isFinite(selected.maxSeats)
              ? `${selected.minSeats}–${selected.maxSeats} seats`
              : "Seats unverified"}
          </p>
          <p>
            {reservation
              ? `${guestName(state, reservation.guestId)} · party of ${reservation.partySize}`
              : "No guest seated"}
          </p>
          <p className="svc-gap">
            {reservation
              ? "Covers follow the reservation party size. A separate cover edit is not in the service contract."
              : "Covers appear after the host seats a guest."}
          </p>
          <button
            type="button"
            className="svc-primary"
            disabled={!canOpen}
            onClick={() => dispatch("openSession", selected.id, "Dining session open. One kitchen ticket was created.")}
          >
            {session ? "Dining session is open" : "Open dining session"}
          </button>
          <p id="open-session-gap" className="svc-gap">
            {session
              ? "A second session and a second kitchen ticket are blocked."
              : "The host seats the guest before a session can open."}
          </p>
        </section>
      )}

      {session && order && (
        <div className="svc-order-layout">
          <section className="svc-card" aria-label="Open order">
            <h2>Order</h2>
            {ticket && (
              <p>
                Kitchen <span className="svc-status" data-status={ticket.status}>{statusLabel(ticket.status)}</span>
              </p>
            )}
            {order.items.length === 0 && <p>No items yet.</p>}
            <ul className="svc-lines">
              {order.items.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <span>{money(item.price)}</span>
                  {item.modifiers.length > 0 && <span>{item.modifiers.map((modifier) => modifier.name).join(", ")}</span>}
                  {item.instructions ? <span>Instruction: {item.instructions}</span> : null}
                  <span className="svc-status" data-status={item.status}>{statusLabel(item.status)}</span>
                </li>
              ))}
            </ul>
            {order.items.length > 0 && <p>Order so far {money(running)}. No bill from this phone.</p>}
            <button
              type="button"
              className="svc-primary"
              disabled={ticket?.status !== "ready"}
              aria-describedby="serve-gap"
              onClick={() => dispatch("markServed", order.id, "Items marked served.")}
            >
              Mark served
            </button>
            <p id="serve-gap" className="svc-gap">
              {ticket?.status === "ready"
                ? "Marks every item on this ticket served."
                : "The kitchen marks the ticket ready before it can be served."}
            </p>
            <button
              type="button"
              disabled={!order.items.length}
              aria-describedby="bill-gap"
              onClick={requestBill}
            >
              Request bill
            </button>
            <p id="bill-gap" className="svc-gap">
              {screen.billRequests[session.id]
                ? "The cashier can see this request. Opening the bill is the cashier action."
                : order.items.length
                  ? "Asks the cashier to open the bill. It does not create a bill."
                  : "Add items before requesting a bill."}
            </p>
            {(ticket?.status === "ready" || ticket?.status === "served") && (
              <button type="button" onClick={() => onRole("cashier")}>Continue to cashier</button>
            )}
            {order.items.length > 0 && (ticket?.status === "queued" || ticket?.status === "preparing") && (
              <button type="button" onClick={() => onRole("kitchen")}>Continue to kitchen</button>
            )}
          </section>

          <section className="svc-card" aria-label="Menu">
            <h2>Menu</h2>
            <CatalogueNotes menu={menu} />
            {menu.lines.length === 0 && <p>No orderable products are available.</p>}
            {menu.lines.map((line) => {
              const modifierIds = chosen[line.itemId] || [];
              const extra = line.modifiers
                .filter((modifier) => modifierIds.includes(modifier.id))
                .reduce((sum, modifier) => sum + modifier.price, 0);
              const gap = !line.orderable
                ? "This catalogue item is not in the simulated service menu, so it cannot be sent."
                : "Adds to the open order. The kitchen keeps the same ticket.";
              return (
                <article key={line.itemId} className="svc-product">
                  <h3>{line.name}</h3>
                  <p>{money(line.price + extra)}</p>
                  {line.modifiers.length > 0 && (
                    <fieldset>
                      <legend>Modifiers</legend>
                      {line.modifiers.map((modifier) => (
                        <label key={modifier.id}>
                          <input
                            type="checkbox"
                            checked={modifierIds.includes(modifier.id)}
                            onChange={() => toggleModifier(line.itemId, modifier.id)}
                          />
                          {modifier.name} · {money(modifier.price)}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <label>
                    Special instructions for {line.name}
                    <textarea
                      value={drafts[line.itemId] || ""}
                      onChange={(event) => setDrafts((prev) => ({ ...prev, [line.itemId]: event.target.value }))}
                    />
                  </label>
                  <p className="svc-gap">Instructions are saved on the order line.</p>
                  <button
                    type="button"
                    className="svc-primary"
                    disabled={!line.orderable}
                    aria-describedby={`send-gap-${line.itemId}`}
                    onClick={() => send(line)}
                  >
                    {order.items.length ? `Add ${line.name}` : `Send ${line.name}`}
                  </button>
                  <p id={`send-gap-${line.itemId}`} className="svc-gap">{gap}</p>
                </article>
              );
            })}
          </section>
        </div>
      )}

      {!session && (
        <section className="svc-card" aria-label="Menu">
          <h2>Menu</h2>
          <p className="svc-gap">Browse now. Sending waits until the dining session is open.</p>
          <CatalogueNotes menu={menu} />
          {menu.lines.length === 0 && <p>No orderable products are available.</p>}
          <ul className="svc-list">
            {menu.lines.map((line) => (
              <li key={line.itemId}>
                <article>
                  <h3>{line.name}</h3>
                  <p>{money(line.price)}</p>
                  <button type="button" disabled aria-describedby={`send-gap-${line.itemId}`}>
                    Send {line.name}
                  </button>
                  <p id={`send-gap-${line.itemId}`} className="svc-gap">
                    {line.orderable
                      ? "Open the dining session before sending."
                      : "This catalogue item is not in the simulated service menu, so it cannot be sent."}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="svc-card">
        <summary>Floor view</summary>
        <FloorPlan state={state} selectedId={selected?.id || null} onSelect={setSelectedId} />
      </details>
    </div>
  );
}
