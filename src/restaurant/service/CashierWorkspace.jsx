import React, { useEffect, useState } from "react";
import {
  discountExplanation,
  guestName,
  money,
  paidToward,
  paymentCall,
  SEPARATE_BILL_MESSAGE,
  SIMULATED_TENDERS,
  statusLabel,
} from "./serviceShared";

export default function CashierWorkspace({ restaurant, dispatch, screen, setScreen, role }) {
  const state = restaurant.state;
  const openSessions = state.sessions.filter((row) => row.status === "open");
  const [selectedId, setSelectedId] = useState(null);
  const [amount, setAmount] = useState("");
  const selected = openSessions.find((row) => row.id === selectedId) || openSessions[0] || null;
  const order = selected ? state.orders.find((row) => row.sessionId === selected.id) : null;
  const sessionBills = selected ? state.bills.filter((row) => row.sessionId === selected.id) : [];
  const bill = sessionBills.find((row) => !row.partId) || null;
  const checks = sessionBills.filter((row) => row.partId);
  const history = selected ? (state.adjustments || []).filter((row) => row.sessionId === selected.id) : [];
  const table = selected ? state.tables.find((row) => row.id === selected.tableId) : null;
  const paid = bill ? paidToward(state.payments, bill.id) : 0;
  const totalKnown = Number.isFinite(bill?.total);
  const due = state.developmentDatabase && Number.isFinite(bill?.outstanding)
    ? bill.outstanding
    : (totalKnown ? bill.total - paid : null);
  const itemPrices = (order?.items || []).filter((item) => item.status !== "cancelled").map((item) => item.price);
  const itemSum = itemPrices.length && itemPrices.every((price) => Number.isFinite(price))
    ? itemPrices.reduce((sum, price) => sum + price, 0)
    : null;
  const discount = discountExplanation(role);

  useEffect(() => {
    if (!bill || bill.status === "paid" || !Number.isFinite(due)) return;
    setAmount(String(due));
  }, [bill, due]);

  function pay(tender) {
    if (!selected || !bill || bill.status === "paid") return;
    const result = dispatch(
      state.developmentDatabase ? "recordSimulatedPayment" : "pay",
      state.developmentDatabase
        ? { billId: bill.id, sessionId: selected.id, amount, tender: tender.id, idempotencyKey: `${tender.id}:${amount}:${bill.id}:${paid}` }
        : [selected.id, paymentCall(amount, tender.id)],
      state.developmentDatabase
        ? `${tender.name} recorded in TEST MODE. No payment was captured.`
        : `${tender.name} recorded as a simulated payment.`,
    );
    if (!result.ok) return;
    setScreen((prev) => ({
      ...prev,
      tenders: {
        ...prev.tenders,
        [result.payment.id]: { tender: tender.id, seenAt: Date.now() },
      },
    }));
  }

  return (
    <div className="svc-cashier">
      <section className="svc-card" aria-label="Open bills">
        <h2>Bills</h2>
        {openSessions.length === 0 && <p>No open table to bill.</p>}
        <ul className="svc-list">
          {openSessions.map((session) => {
            const sessionTable = state.tables.find((row) => row.id === session.tableId);
            const sessionBill = state.bills.find((row) => row.sessionId === session.id && !row.partId);
            const requested = screen.billRequests[session.id] && !sessionBill;
            return (
              <li key={session.id}>
                <button type="button" aria-pressed={selected?.id === session.id} onClick={() => setSelectedId(session.id)}>
                  {sessionTable ? `Table ${sessionTable.label}` : "Table unavailable"}
                  {" · "}{guestName(state, session.guestId)}
                  {requested ? " · Bill requested" : ""}
                  {sessionBill ? ` · ${statusLabel(sessionBill.status)}` : " · No bill"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="svc-card" aria-label="Bill detail">
        {!selected && <p>Select an open table.</p>}
        {selected && (
          <>
            <h2>{table ? `Table ${table.label}` : "Table unavailable"}</h2>
            <p>{guestName(state, selected.guestId)}</p>
            {screen.billRequests[selected.id] && !bill && <p className="svc-screen-flag">Bill requested on the waiter screen</p>}
            <h3>Itemized charges</h3>
            {order?.items?.length ? (
              <ul className="svc-lines">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.name}</span>
                    <span>{item.status === "cancelled" ? "Voided" : money(item.price)}</span>
                    {item.status === "cancelled" && <span>Kept in the order history.</span>}
                    {item.modifiers?.length > 0 && <span>{item.modifiers.map((modifier) => modifier.name).join(", ")}</span>}
                    {screen.notes[item.id] && <span className="svc-screen-note">Screen note: {screen.notes[item.id]}. Not a charge.</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nothing to bill yet.</p>
            )}
            {bill ? <p>Bill total {money(bill.total)} · {statusLabel(bill.status)}</p> : <p>No bill open.</p>}
            {bill?.amountProvenance === "reconstructed" && <p>{bill.amountLimitation}</p>}
            {bill?.amountProvenance === "snapshot" && Number.isInteger(bill.totalMinor) && <p>Persisted total {money(bill.totalMinor / 100)}.</p>}
            {bill && !totalKnown && <p>Bill total is not recorded. No payment was captured.</p>}
            {bill && totalKnown && Number.isFinite(itemSum) && itemSum !== bill.total && (
              <p>Items now total {money(itemSum)}. The bill total was fixed when it opened. A bill amendment is not in the service contract.</p>
            )}
            {!state.developmentDatabase && bill && totalKnown && paid === 0 && due > 0 && <p>No payments yet · Remaining {money(due)}</p>}
            {!state.developmentDatabase && bill && totalKnown && paid > 0 && due > 0 && <p>Paid {money(paid)} · Remaining {money(due)}</p>}
            {!state.developmentDatabase && bill && totalKnown && due === 0 && <p>Paid in full · {money(bill.total)}</p>}
            {state.developmentDatabase && bill && <p>Outstanding {money(bill.outstanding)}. TEST MODE. No payment was captured.</p>}
            {bill?.taxTreatment === "unknown" && <p>Tax treatment is not recorded for this bill. No VAT amount was added.</p>}
            {bill?.taxTreatment === "inclusive" && bill.taxSource === "not_finalized" && <p>Prices are VAT-inclusive at 15%. VAT is recorded when the simulated balance is settled.</p>}
            {Number.isInteger(bill?.vatMinor) && <p>Taxable {(bill.taxableMinor / 100).toFixed(2)} SAR · VAT {(bill.vatMinor / 100).toFixed(2)} SAR · TEST MODE snapshot.</p>}
            {checks.length > 0 && (
              <ul className="svc-lines">
                {checks.map((check, index) => (
                  <li key={check.id}>
                    <span>Unpaid check {index + 1}</span>
                    <span>{money(check.outstanding)}</span>
                    <span>Open. No payment captured.</span>
                  </li>
                ))}
              </ul>
            )}
            {history.length > 0 && (
              <ul className="svc-lines">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <span>{entry.kind === "void" ? "Void" : entry.kind === "discount" ? "Discount" : entry.checkBillId ? "Unpaid check" : "Split note, not a separate check"} · {entry.reason}</span>
                    <span>{Number.isFinite(entry.amount) ? money(entry.amount) : "Amount recorded on the line"}</span>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="svc-primary"
              disabled={!order?.items?.length || Boolean(bill)}
              onClick={() => dispatch("openBill", selected.id, state.developmentDatabase ? "Bill opened in the local development database. No payment was captured." : "Bill opened in this simulation.")}
            >
              Open bill
            </button>
            {order?.items?.some((item) => item.status !== "served") && !bill && (
              <p className="svc-gap">Some items are not marked served. The contract still allows the bill to open.</p>
            )}
            {bill && bill.status !== "paid" && (
              <label>
                Payment amount
                <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
            )}
            <fieldset>
              <legend>Simulated tender</legend>
              <div className="svc-actions">
                {SIMULATED_TENDERS.map((tender) => (
                  <button key={tender.id} type="button" disabled={!bill || bill.finalizedAt || bill.taxTreatment === "unknown"} onClick={() => pay(tender)}>
                    {tender.label}
                  </button>
                ))}
              </div>
              <p className="svc-gap">
                Cash, card, and transfer are screen labels. Each one records method simulated.
                Cash drawers and card networks are not connected. Enter less than the remaining amount for a partial payment.
              </p>
            </fieldset>
            <button type="button" disabled aria-describedby="discount-gap">Apply discount</button>
            <p id="discount-gap" className="svc-gap">{state.developmentDatabase
              ? "Discounts and voids need a manager. A cashier can divide the remaining balance into unpaid checks. Nothing is marked paid."
              : discount.message}</p>
            {state.developmentDatabase && bill?.status === "open" && (
              <>
                <button type="button" onClick={() => dispatch("discountBill", { billId: bill.id, basis: "amount", value: 5, reason: "Fixed manager discount", idempotencyKey: `fixed-5:${bill.id}` }, "Five SAR recorded. The bill stays unpaid.")}>
                  Record 5 SAR
                </button>
                <button type="button" onClick={() => {
                  const line = order?.items?.find((item) => item.status !== "cancelled");
                  if (!line) return;
                  dispatch("discountBill", { billId: bill.id, itemId: line.id, basis: "percent", value: 10, reason: "Item discount", idempotencyKey: `item-10:${line.id}` }, "Item discount recorded. The bill stays unpaid.");
                }}>
                  Discount one item 10 percent
                </button>
                <button type="button" onClick={() => {
                  const line = order?.items?.find((item) => item.status !== "cancelled");
                  if (!line) return;
                  dispatch("voidItem", { billId: bill.id, itemId: line.id, reason: "Manager void", idempotencyKey: `void:${line.id}` }, "Item voided. The line stays in the history and the bill stays unpaid.");
                }}>
                  Void one item
                </button>
                <button type="button" onClick={() => {
                  const ids = (order?.items || []).filter((item) => item.status !== "cancelled").slice(0, 1).map((item) => item.id);
                  dispatch("splitBill", { billId: bill.id, itemIds: ids, reason: "Split selected items", idempotencyKey: `items:${bill.id}:${ids.join(",")}` }, "Selected items moved to an unpaid check.");
                }}>
                  Split selected items
                </button>
                <button type="button" onClick={() => dispatch("splitBill", { billId: bill.id, basis: "guest", reason: "Split by recorded party size" }, "Split by the recorded party size. TEST MODE.")}>
                  Split by guest
                </button>
                <button type="button" onClick={() => dispatch("discountBill", { billId: bill.id, basis: "percent", value: 10, reason: "Manager test discount", idempotencyKey: `percent-10:${bill.id}` }, "Ten percent recorded. The bill stays unpaid.")}>
                  Record 10 percent
                </button>
                <button type="button" onClick={() => dispatch("splitBill", { billId: bill.id, parts: 2, reason: "Split equally for preparation" }, "Split prepared. Nothing was collected.")}>
                  Prepare equal split
                </button>
                <p className="svc-gap">TEST MODE. A missing price snapshot blocks these adjustments. VAT is taken from the inclusive price when the bill is settled. The bill is not marked paid.</p>
            <button type="button" disabled={!bill || bill.finalizedAt || bill.taxTreatment === "unknown"} onClick={() => dispatch("finalizeBill", { billId: bill.id }, "Simulated balance settled. TEST MODE. No payment was captured.")}>Settle simulated balance</button>
            <label>Opening float<input id="opening-float" inputMode="decimal" /></label>
            <button type="button" onClick={() => {
              const opening = document.getElementById("opening-float")?.value;
              dispatch("openShift", { openingFloat: opening }, "TEST MODE shift opened.");
            }}>Open shift</button>
            <label>Counted cash<input id="counted-cash" inputMode="decimal" /></label>
            <button type="button" onClick={() => {
              const counted = document.getElementById("counted-cash")?.value;
              const shift = (state.shifts || []).find((row) => row.status === "open");
              if (!shift) return;
              dispatch("closeShift", { shiftId: shift.id, countedCash: counted, note: "Counted in TEST MODE" }, "TEST MODE shift closed. The variance is kept.");
            }}>Close shift</button>
              </>
            )}
            <button type="button" disabled aria-describedby="split-gap">Split into separate bills</button>
            <p id="split-gap" className="svc-gap">{state.developmentDatabase
              ? "Separate checks stay unpaid. No payment is captured."
              : SEPARATE_BILL_MESSAGE}</p>
            <button
              type="button"
              className="svc-primary"
              disabled={state.developmentDatabase ? bill?.status !== "open" : bill?.status !== "paid"}
              aria-describedby="close-gap"
              onClick={() => dispatch("closeTable", selected.id, state.developmentDatabase
                ? "Session closed without a payment capture. The table is cleaning."
                : "Table closed. The visit stays in this simulation.")}
            >
              Close table
            </button>
            <p id="close-gap" className="svc-gap">
              {state.developmentDatabase
                ? "No card or cash payment is captured. Closing records the bill as unpaid and puts the table into cleaning."
                : bill?.status === "paid"
                  ? "Closes the session and frees the table."
                  : "The bill must be paid before the table can close."}
            </p>
          </>
        )}
      </section>

      <section className="svc-card" aria-label="Transaction history">
        <h2>History</h2>
        {state.payments.length === 0 && state.visits.length === 0 && <p>No payments or closed visits yet.</p>}
        <ul className="svc-list">
          {state.payments.map((payment) => {
            const tenderId = payment.tender || screen.tenders[payment.id]?.tender;
            const tender = SIMULATED_TENDERS.find((row) => row.id === tenderId);
            const seenAt = payment.recordedAt || screen.tenders[payment.id]?.seenAt;
            const seenDate = seenAt ? new Date(seenAt) : null;
            const seen = seenDate && !Number.isNaN(seenDate.getTime())
              ? ` · ${seenDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : " · the payment record has no timestamp";
            return (
              <li key={payment.id}>
                {tender ? tender.name : "Simulated"} · {money(payment.amount)} · contract method {payment.method}{seen}
              </li>
            );
          })}
          {state.visits.map((visit) => (
            <li key={visit.id}>Visit for {guestName(state, visit.guestId)} · {money(visit.total)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
