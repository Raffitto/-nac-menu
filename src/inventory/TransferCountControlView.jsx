import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, RefreshCw } from "lucide-react";
import {
  confirmStockCountWarning,
  createCountSession,
  createTransfer,
  dispatchTransfer,
  fetchCountSessionDetails,
  fetchCountSessions,
  fetchInventoryReferenceData,
  fetchInventoryStaffAccess,
  fetchTransfers,
  receiveTransfer,
  saveCountSessionLine,
  transitionCountSession,
  transitionTransfer,
} from "../lib/inventoryApi";
import { canManageBranchIngredients } from "./ingredientMaster";
import { filterCountTotals } from "./inventoryOperations";

const todayInRiyadh = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const humanize = (value) => String(value || "").replaceAll("_", " ");

function transferActions(status) {
  if (status === "draft") return ["requested", "cancelled"];
  if (status === "requested") return ["approved", "rejected", "cancelled"];
  if (status === "approved") return ["dispatch"];
  if (status === "dispatched") return ["receive"];
  if (status === "received") return ["closed"];
  return [];
}

function countActions(status) {
  if (["draft", "in_progress"].includes(status)) return ["submitted"];
  if (status === "submitted") return ["reviewed"];
  if (status === "reviewed") return ["approved"];
  if (status === "approved") return ["posted"];
  return [];
}

export default function TransferCountControlView({ branchId, mode }) {
  const [reference, setReference] = useState({ ingredients: [], locations: [] });
  const [access, setAccess] = useState(null);
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [countFilter, setCountFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canManage = canManageBranchIngredients(access, branchId);
  const selected = rows.find(({ id }) => id === selectedId) || rows[0] || null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [referenceRows, staffAccess, operationRows] = await Promise.all([
        fetchInventoryReferenceData(branchId),
        fetchInventoryStaffAccess(),
        mode === "transfers" ? fetchTransfers(branchId) : fetchCountSessions(branchId),
      ]);
      setReference(referenceRows);
      setAccess(staffAccess);
      setRows(operationRows || []);
    } catch (err) {
      setError(err.message || "Could not load inventory operations.");
    } finally {
      setLoading(false);
    }
  }, [branchId, mode]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedSession(null);
    setShowCreate(false);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (mode !== "stock-counts" || !selected) {
      setSelectedSession(null);
      return;
    }
    fetchCountSessionDetails(selected.id)
      .then(setSelectedSession)
      .catch((err) => setError(err.message));
  }, [mode, selected]);

  const run = async (operation, success) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      setNotice(success);
      await refresh();
      return result;
    } catch (err) {
      setError(err.message || "Inventory operation failed.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const createTransferRequest = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const item = reference.ingredients.find(({ id }) => id === values.get("ingredientId"));
    const result = await run(() => createTransfer({
      sourceBranchId: branchId,
      sourceLocationId: values.get("sourceLocationId"),
      destinationBranchId: branchId,
      destinationLocationId: values.get("destinationLocationId"),
      businessDate: values.get("businessDate"),
      notes: values.get("notes"),
      evidence: { entryMethod: "transfer_control" },
      idempotencyKey: `transfer:${branchId}:${crypto.randomUUID()}`,
      lines: [{
        lineNumber: 1,
        ingredientId: item.id,
        sourceQuantity: values.get("quantity"),
        sourceUnit: item.base_inventory_unit,
        conversionFactor: "1",
        normalizedQuantity: values.get("quantity"),
        canonicalUnit: item.base_inventory_unit,
      }],
    }), "Transfer draft created.");
    if (result) setShowCreate(false);
  };

  const createSession = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const result = await run(() => createCountSession({
      branchId,
      businessDate: values.get("businessDate"),
      notes: values.get("notes"),
      locationIds: values.getAll("locationIds"),
      evidence: { entryMethod: "count_control" },
      idempotencyKey: `count-session:${branchId}:${crypto.randomUUID()}`,
    }), "Multi-location count session created.");
    if (result) setShowCreate(false);
  };

  const transitionSelectedTransfer = async (action) => {
    const reason = window.prompt(`Reason for ${action}:`);
    if (!reason) return;
    if (action === "dispatch") {
      await run(
        () => dispatchTransfer(
          selected.id,
          selected.inventory_transfer_lines.map((line) => ({
            lineId: line.id,
            sentQuantity: line.requested_quantity,
          })),
          reason,
          `transfer-dispatch:${selected.id}`,
        ),
        "Transfer dispatched. Source stock posted.",
      );
      return;
    }
    if (action === "receive") {
      const receivedLines = selected.inventory_transfer_lines.map((line) => {
        const answer = window.prompt(
          `Received ${humanize(line.canonical_unit)} for line ${line.line_number}:`,
          String(line.sent_quantity),
        );
        return { lineId: line.id, receivedQuantity: answer };
      });
      if (receivedLines.some(({ receivedQuantity }) => receivedQuantity == null || receivedQuantity === "")) return;
      await run(
        () => receiveTransfer(
          selected.id,
          receivedLines,
          reason,
          `transfer-receive:${selected.id}`,
        ),
        "Transfer received. Destination stock posted and discrepancies checked.",
      );
      return;
    }
    await run(
      () => transitionTransfer(selected.id, action, reason),
      `Transfer moved to ${humanize(action)}.`,
    );
  };

  const saveCountLine = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const count = selectedSession.counts.find(({ id }) => id === values.get("stockCountId"));
    const item = reference.ingredients.find(({ id }) => id === values.get("ingredientId"));
    const conversion = values.get("conversionFactor");
    const sourceQuantity = values.get("sourceQuantity");
    const result = await run(
      () => saveCountSessionLine(count.id, {
        ingredientId: item.id,
        sourceQuantity,
        sourceUnit: values.get("sourceUnit"),
        conversionFactor: conversion,
        normalizedQuantity: Number(sourceQuantity) * Number(conversion),
        canonicalUnit: item.base_inventory_unit,
        notes: values.get("notes"),
        evidence: { entryMethod: "count_control" },
      }),
      "Location count saved with an expected-stock snapshot.",
    );
    if (result?.warnings?.length) setNotice("Count saved with a warning requiring review.");
  };

  const transitionSelectedSession = async (status) => {
    const reason = window.prompt(`Reason for ${status}:`);
    if (!reason) return;
    await run(
      () => transitionCountSession(
        selected.id,
        status,
        reason,
        status === "posted" ? `count-session-post:${selected.id}` : null,
      ),
      `Count session moved to ${humanize(status)}.`,
    );
  };

  const visibleTotals = useMemo(() => {
    return filterCountTotals(selectedSession?.totals || [], countFilter);
  }, [countFilter, selectedSession]);

  const warningLines = useMemo(() => (selectedSession?.counts || []).flatMap(
    (count) => (count.inventory_stock_count_lines || [])
      .filter((line) => (line.guardrail_warnings || []).length)
      .map((line) => ({ ...line, storageLocationId: count.storage_location_id })),
  ), [selectedSession]);

  if (loading) {
    return <section className="inv-operations-state"><Loader2 className="inv-spin" size={22} /> Loading operations…</section>;
  }

  return (
    <section className="inv-procurement" data-testid={`inventory-operations-${mode}`}>
      {(error || notice) && (
        <div className={`inv-banner ${error ? "inv-banner--error" : "inv-banner--success"}`}>
          {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
        </div>
      )}
      <div className="inv-procurement-toolbar">
        <div>
          <p className="inv-kicker">Inventory operations</p>
          <h2>{mode === "transfers" ? "Transfers" : "Stock Counts"}</h2>
          <p>{mode === "transfers"
            ? "Dispatch removes source stock; destination stock posts only when receipt is confirmed."
            : "Count each storage location separately, then review the combined physical total."}</p>
        </div>
        <div>
          <button className="inv-button inv-button--ghost" onClick={refresh}><RefreshCw size={16} /> Refresh</button>
          <button className="inv-button inv-button--primary" disabled={!canManage} onClick={() => setShowCreate((value) => !value)}>
            <Plus size={16} /> New {mode === "transfers" ? "transfer" : "count"}
          </button>
        </div>
      </div>

      {showCreate && (
        <form className="inv-procurement-form" onSubmit={mode === "transfers" ? createTransferRequest : createSession}>
          <h3>{mode === "transfers" ? "Transfer draft" : "Multi-location count session"}</h3>
          <label>Business date<input name="businessDate" type="date" defaultValue={todayInRiyadh()} required /></label>
          {mode === "transfers" ? (
            <>
              <label>Source location<select name="sourceLocationId" required><option value="">Select</option>{reference.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              <label>Destination location<select name="destinationLocationId" required><option value="">Select</option>{reference.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              <label>Item<select name="ingredientId" required><option value="">Select</option>{reference.ingredients.map((row) => <option key={row.id} value={row.id}>{row.canonical_name}</option>)}</select></label>
              <label>Quantity<input name="quantity" type="number" min="0.00000001" step="any" required /></label>
            </>
          ) : (
            <label>Storage locations<select name="locationIds" multiple required size={Math.min(6, Math.max(2, reference.locations.length))}>{reference.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          )}
          <label className="inv-procurement-wide">Notes<textarea name="notes" rows={2} /></label>
          <button className="inv-button inv-button--primary" disabled={saving} type="submit">Create draft</button>
        </form>
      )}

      <div className="inv-procurement-layout">
        <div className="inv-procurement-list">
          {rows.length === 0 && <p className="inv-empty">No {humanize(mode)} yet.</p>}
          {rows.map((row) => (
            <button key={row.id} className={`inv-procurement-row ${selected?.id === row.id ? "is-selected" : ""}`} onClick={() => setSelectedId(row.id)}>
              <strong>{mode === "transfers" ? `${row.source_branch_id} → ${row.destination_branch_id}` : row.business_date}</strong>
              <span>{humanize(row.status)}</span>
              <small>{mode === "transfers" ? row.business_date : `${row.id.slice(0, 8)} · multi-location`}</small>
            </button>
          ))}
        </div>

        <div className="inv-procurement-detail">
          {!selected && <p className="inv-empty">Select a record.</p>}
          {selected && mode === "transfers" && (
            <>
              <div className="inv-procurement-detail-head">
                <div><p className="inv-kicker">Transfer</p><h3>{selected.source_branch_id} → {selected.destination_branch_id}</h3></div>
                <span className="inv-status-badge">{humanize(selected.status)}</span>
              </div>
              {(selected.inventory_transfer_lines || []).map((line) => (
                <div className="inv-procurement-line" key={line.id}>
                  <strong>Line {line.line_number}</strong>
                  <span>Requested {line.requested_quantity} {line.canonical_unit}</span>
                  <span>Sent {line.sent_quantity ?? "—"} · received {line.received_quantity ?? "—"}</span>
                </div>
              ))}
              <div className="inv-procurement-actions">
                {transferActions(selected.status).map((action) => (
                  <button key={action} className="inv-button inv-button--primary" disabled={saving || !canManage} onClick={() => transitionSelectedTransfer(action)}>{humanize(action)}</button>
                ))}
              </div>
            </>
          )}
          {selected && mode === "stock-counts" && selectedSession && (
            <>
              <div className="inv-procurement-detail-head">
                <div><p className="inv-kicker">Count session</p><h3>{selected.business_date}</h3></div>
                <span className="inv-status-badge">{humanize(selected.status)}</span>
              </div>
              {["draft", "in_progress"].includes(selected.status) && (
                <form className="inv-procurement-line-form" onSubmit={saveCountLine}>
                  <select name="stockCountId" aria-label="Count location" required>
                    <option value="">Location</option>
                    {selectedSession.counts.map((count) => {
                      const location = reference.locations.find(({ id }) => id === count.storage_location_id);
                      return <option key={count.id} value={count.id}>{location?.name || count.storage_location_id}</option>;
                    })}
                  </select>
                  <select name="ingredientId" aria-label="Count item" required><option value="">Item</option>{reference.ingredients.map((item) => <option key={item.id} value={item.id}>{item.canonical_name}</option>)}</select>
                  <input name="sourceQuantity" aria-label="Count quantity" type="number" min="0" step="any" required />
                  <input name="sourceUnit" aria-label="Count unit" placeholder="unit" required />
                  <input name="conversionFactor" aria-label="Conversion factor" type="number" min="0.00000001" step="any" defaultValue="1" required />
                  <input name="notes" aria-label="Count notes" placeholder="notes" />
                  <button className="inv-button inv-button--primary" type="submit" disabled={saving}>Save</button>
                </form>
              )}
              <div className="inv-procurement-actions">
                {["all", "uncounted", "warnings", "high-value", "high-percentage", "unresolved-units"].map((filter) => (
                  <button key={filter} className={`inv-button ${countFilter === filter ? "inv-button--primary" : "inv-button--ghost"}`} onClick={() => setCountFilter(filter)}>{humanize(filter)}</button>
                ))}
              </div>
              {visibleTotals.map((total) => (
                <div className="inv-procurement-line" key={total.ingredient_id}>
                  <strong>{reference.ingredients.find(({ id }) => id === total.ingredient_id)?.canonical_name || total.ingredient_id}</strong>
                  <span>{total.counted_location_count}/{total.selected_location_count} locations · counted {total.counted_quantity ?? "—"} {total.canonical_unit}</span>
                  <span>Expected {total.expected_quantity} · variance {total.variance_quantity}</span>
                  {total.has_warning && <span><AlertTriangle size={14} /> Review warning</span>}
                </div>
              ))}
              {warningLines.map((line) => (
                <div className="inv-procurement-line" key={`warning:${line.id}`}>
                  <strong><AlertTriangle size={14} /> Count warning</strong>
                  <span>{(line.guardrail_warnings || []).map(({ message }) => message).join(" ")}</span>
                  <span>{line.warning_confirmation_reason || "Privileged confirmation required before posting."}</span>
                  {!line.warning_confirmation_reason && (
                    <button
                      className="inv-button inv-button--ghost"
                      disabled={!canManage || saving}
                      onClick={async () => {
                        const reason = window.prompt("Reason for confirming this unusual count:");
                        if (!reason) return;
                        await run(
                          () => confirmStockCountWarning(line.id, reason),
                          "Unusual count confirmed with an audit reason.",
                        );
                      }}
                    >
                      Confirm warning
                    </button>
                  )}
                </div>
              ))}
              <div className="inv-procurement-actions">
                {countActions(selected.status).map((action) => (
                  <button key={action} className="inv-button inv-button--primary" disabled={saving || !canManage} onClick={() => transitionSelectedSession(action)}>{humanize(action)}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
