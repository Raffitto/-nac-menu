import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  createOperationalEvent,
  fetchInventoryExceptions,
  fetchInventoryReferenceData,
  fetchInventoryStaffAccess,
  fetchOperationalEvents,
} from "../lib/inventoryApi";
import { canManageBranchIngredients, unitLabel } from "./ingredientMaster";
import { OPERATIONAL_MOVEMENT_OPTIONS } from "./inventoryControls";

const todayInRiyadh = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const initialForm = () => ({
  action: "disposal",
  ingredientId: "",
  locationId: "",
  quantity: "",
  businessDate: todayInRiyadh(),
  reason: "",
  notes: "",
});

export default function OperationalControlView({ branchId }) {
  const [reference, setReference] = useState({ ingredients: [], locations: [] });
  const [events, setEvents] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [access, setAccess] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canPost = canManageBranchIngredients(access, branchId);
  const ingredient = useMemo(
    () => reference.ingredients.find(({ id }) => id === form.ingredientId),
    [reference.ingredients, form.ingredientId],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [referenceData, eventRows, exceptionRows, staffAccess] = await Promise.all([
        fetchInventoryReferenceData(branchId),
        fetchOperationalEvents({ branchId }),
        fetchInventoryExceptions({ branchId }),
        fetchInventoryStaffAccess(),
      ]);
      setReference(referenceData);
      setEvents(eventRows || []);
      setExceptions(exceptionRows || []);
      setAccess(staffAccess);
      setForm((previous) => ({
        ...previous,
        ingredientId: previous.ingredientId || referenceData.ingredients?.[0]?.id || "",
        locationId: previous.locationId || referenceData.locations?.[0]?.id || "",
      }));
    } catch (err) {
      setError(err.message || "Could not load operational inventory controls.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    setForm(initialForm());
    refresh();
  }, [refresh]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canPost || saving) return;
    if (!ingredient || !form.locationId || Number(form.quantity) <= 0 || !form.reason.trim()) {
      setError("Choose an item and location, enter a positive quantity, and provide a reason.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const idempotencyKey = `operational:${branchId}:${form.action}:${crypto.randomUUID()}`;
      await createOperationalEvent(form.action, {
        branchId,
        locationId: form.locationId,
        ingredientId: ingredient.id,
        canonicalQuantity: form.quantity,
        canonicalUnit: ingredient.base_inventory_unit || ingredient.baseInventoryUnit,
        sourceQuantity: form.quantity,
        sourceUnit: ingredient.base_inventory_unit || ingredient.baseInventoryUnit,
        conversionFactor: "1",
        businessDate: form.businessDate,
        effectiveAt: `${form.businessDate}T12:00:00+03:00`,
        reason: form.reason.trim(),
        notes: form.notes.trim() || null,
        evidence: { entryMethod: "inventory_command_center" },
        idempotencyKey,
      });
      setNotice("Operational movement posted to the immutable inventory ledger.");
      setForm((previous) => ({ ...initialForm(), ingredientId: previous.ingredientId, locationId: previous.locationId }));
      await refresh();
    } catch (err) {
      setError(err.message || "Could not post operational movement.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <section className="inv-operations-state"><Loader2 className="inv-spin" size={22} /> Loading controls…</section>;
  }

  return (
    <section className="inv-operations" data-testid="operational-control-view">
      {(error || notice) ? (
        <div className={`inv-banner ${error ? "inv-banner--error" : "inv-banner--success"}`}>
          {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
        </div>
      ) : null}

      <div className="inv-operations-grid">
        <form className="inv-operations-card" onSubmit={handleSubmit}>
          <div>
            <p className="inv-kicker">Controlled stock movement</p>
            <h2>Record operational usage</h2>
            <p>Disposal, staff meals, and recorded waste remain distinct and auditable.</p>
          </div>

          <label>
            <span>Movement type</span>
            <select
              value={form.action}
              onChange={(event) => setForm((previous) => ({ ...previous, action: event.target.value }))}
              data-testid="operational-type-select"
            >
              {OPERATIONAL_MOVEMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Inventory item</span>
            <select
              value={form.ingredientId}
              onChange={(event) => setForm((previous) => ({ ...previous, ingredientId: event.target.value }))}
              required
            >
              {reference.ingredients.map((item) => (
                <option key={item.id} value={item.id}>{item.canonical_name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Storage location</span>
            <select
              value={form.locationId}
              onChange={(event) => setForm((previous) => ({ ...previous, locationId: event.target.value }))}
              required
            >
              {reference.locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
          <div className="inv-operations-pair">
            <label>
              <span>Quantity ({unitLabel(ingredient?.base_inventory_unit || ingredient?.baseInventoryUnit)})</span>
              <input
                type="number"
                min="0"
                step="any"
                value={form.quantity}
                onChange={(event) => setForm((previous) => ({ ...previous, quantity: event.target.value }))}
                required
              />
            </label>
            <label>
              <span>Business date</span>
              <input
                type="date"
                value={form.businessDate}
                onChange={(event) => setForm((previous) => ({ ...previous, businessDate: event.target.value }))}
                required
              />
            </label>
          </div>
          <label>
            <span>Reason</span>
            <input
              value={form.reason}
              onChange={(event) => setForm((previous) => ({ ...previous, reason: event.target.value }))}
              placeholder="e.g. Used frying oil disposal"
              required
            />
          </label>
          <label>
            <span>Notes / evidence</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((previous) => ({ ...previous, notes: event.target.value }))}
            />
          </label>
          <button className="inv-button inv-button--primary" type="submit" disabled={!canPost || saving}>
            {saving ? <Loader2 className="inv-spin" size={16} /> : null}
            Post movement
          </button>
          {!canPost ? <p className="inv-ingredients-help">Read-only: posting requires branch inventory approval access.</p> : null}
        </form>

        <div className="inv-operations-stack">
          <section className="inv-operations-card">
            <p className="inv-kicker">Exceptions</p>
            <h2>{exceptions.length} open</h2>
            {exceptions.length ? (
              <ul className="inv-operations-list">
                {exceptions.slice(0, 6).map((exception) => (
                  <li key={exception.id}>
                    <strong>{exception.title}</strong>
                    <span>{exception.message}</span>
                  </li>
                ))}
              </ul>
            ) : <p>No open operational exceptions for this branch.</p>}
          </section>
          <section className="inv-operations-card">
            <p className="inv-kicker">Recent movements</p>
            <h2>{events.length} recorded</h2>
            {events.length ? (
              <ul className="inv-operations-list">
                {events.slice(0, 8).map((eventRow) => (
                  <li key={eventRow.id}>
                    <strong>{eventRow.event_type.replaceAll("_", " ")}</strong>
                    <span>{eventRow.business_date} · {eventRow.reason_code}</span>
                  </li>
                ))}
              </ul>
            ) : <p>No operational movements have been recorded yet.</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
