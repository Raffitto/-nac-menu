import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, RefreshCw } from "lucide-react";
import {
  createPurchaseOrder,
  fetchInventoryAuditTrail,
  fetchInventoryExceptions,
  fetchInventoryReferenceData,
  fetchInventoryStaffAccess,
  fetchPurchaseOrderProgress,
  fetchPurchaseOrders,
  fetchReceiptHistory,
  fetchSupplierReturns,
  postSupplierReturn,
  transitionPurchaseOrder,
} from "../lib/inventoryApi";
import { canManageBranchIngredients } from "./ingredientMaster";
import { nextPurchaseOrderActions } from "./procurementControls";

const todayInRiyadh = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const blankPoLine = () => ({
  ingredientId: "",
  requestedQuantity: "",
  requestedUnit: "",
  normalizedBaseQuantity: "",
  canonicalUnit: "",
  expectedUnitCost: "",
  notes: "",
});

const money = (value) => value == null ? "—" : `${Number(value).toFixed(2)} SAR`;
const label = (value) => String(value || "").replaceAll("_", " ");

function statusTone(status) {
  if (["approved", "received", "closed", "posted"].includes(status)) return "success";
  if (["partially_received", "submitted", "draft"].includes(status)) return "warning";
  if (["cancelled", "rejected", "reversed"].includes(status)) return "danger";
  return "neutral";
}

export default function ProcurementControlView({ branchId, mode = "purchase-orders" }) {
  const [reference, setReference] = useState({ ingredients: [], suppliers: [], locations: [] });
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [returns, setReturns] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [access, setAccess] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [progress, setProgress] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [poLines, setPoLines] = useState([blankPoLine()]);

  const rows = mode === "purchase-orders" ? purchaseOrders : mode === "purchases" ? receipts : returns;
  const selected = rows.find(({ id }) => id === selectedId) || rows[0] || null;
  const canManage = canManageBranchIngredients(access, branchId);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [referenceRows, poRows, receiptRows, returnRows, exceptionRows, staffAccess] = await Promise.all([
        fetchInventoryReferenceData(branchId),
        fetchPurchaseOrders({ branchId }),
        fetchReceiptHistory({ branchId }),
        fetchSupplierReturns({ branchId }),
        fetchInventoryExceptions({ branchId }),
        fetchInventoryStaffAccess(),
      ]);
      setReference(referenceRows);
      setPurchaseOrders(poRows || []);
      setReceipts(receiptRows || []);
      setReturns(returnRows || []);
      setExceptions(exceptionRows || []);
      setAccess(staffAccess);
    } catch (err) {
      setError(err.message || "Could not load procurement controls.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    setSelectedId(null);
    setShowCreate(false);
    refresh();
  }, [mode, refresh]);

  useEffect(() => {
    if (!selected) {
      setProgress([]);
      setAudit([]);
      return;
    }
    const entityType = mode === "purchase-orders"
      ? "inventory_purchase_order"
      : mode === "purchases"
        ? "purchase_receipt"
        : "inventory_supplier_return";
    const requests = [fetchInventoryAuditTrail({ entityType, entityId: selected.id })];
    if (mode === "purchase-orders") requests.push(fetchPurchaseOrderProgress(selected.id));
    Promise.all(requests)
      .then(([auditRows, progressRows = []]) => {
        setAudit(auditRows || []);
        setProgress(progressRows || []);
      })
      .catch((err) => setError(err.message));
  }, [mode, selected]);

  const run = async (operation, success) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(success);
      await refresh();
      return true;
    } catch (err) {
      setError(err.message || "Procurement action failed.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePo = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const saved = await run(() => createPurchaseOrder({
      branchId,
      supplierId: values.get("supplierId"),
      destinationLocationId: values.get("destinationLocationId"),
      referenceNumber: values.get("referenceNumber"),
      businessContext: values.get("businessContext"),
      expectedDeliveryDate: values.get("expectedDeliveryDate"),
      expectedDeliveryTime: values.get("expectedDeliveryTime"),
      notes: values.get("notes"),
      lines: poLines.map((line, index) => ({ ...line, lineNumber: index + 1 })),
    }), "Purchase order created as a draft.");
    if (saved) {
      setShowCreate(false);
      setPoLines([blankPoLine()]);
    }
  };

  const handleCreateReturn = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const ingredient = reference.ingredients.find(({ id }) => id === values.get("ingredientId"));
    const receipt = receipts.find(({ id }) => id === values.get("originalReceiptId"));
    const receiptLine = receipt?.inventory_purchase_receipt_lines?.find(
      ({ ingredient_id }) => ingredient_id === ingredient?.id
    );
    const saved = await run(() => postSupplierReturn({
      branchId,
      supplierId: values.get("supplierId"),
      locationId: values.get("locationId"),
      originalReceiptId: receipt?.id || null,
      purchaseOrderId: receipt?.purchase_order_id || null,
      referenceNumber: values.get("referenceNumber"),
      businessDate: values.get("businessDate"),
      documentDate: values.get("documentDate"),
      reason: values.get("reason"),
      notes: values.get("notes"),
      evidence: { entryMethod: "procurement_control" },
      lines: [{
        lineNumber: 1,
        originalReceiptLineId: receiptLine?.id || null,
        purchaseOrderLineId: receiptLine?.purchase_order_line_id || null,
        ingredientId: ingredient.id,
        sourceItemName: receiptLine?.original_description || ingredient.canonical_name,
        sourceSku: receiptLine?.supplier_sku || null,
        sourceQuantity: values.get("quantity"),
        sourceUnit: ingredient.base_inventory_unit,
        conversionFactor: "1",
        normalizedQuantity: values.get("quantity"),
        canonicalUnit: ingredient.base_inventory_unit,
        unitCostBasis: receiptLine?.unit_cost_canonical || null,
        reason: values.get("reason"),
        evidence: { originalReceiptLineId: receiptLine?.id || null },
      }],
    }), "Supplier return posted to the immutable ledger.");
    if (saved) setShowCreate(false);
  };

  const exceptionCount = useMemo(() => {
    if (!selected) return 0;
    const lineIds = new Set([
      ...(selected.inventory_purchase_order_lines || []).map(({ id }) => id),
      ...(selected.inventory_purchase_receipt_lines || []).map(({ id }) => id),
      ...(selected.inventory_supplier_return_lines || []).map(({ id }) => id),
    ]);
    return exceptions.filter(({ entity_id, status }) => status === "open" && lineIds.has(entity_id)).length;
  }, [exceptions, selected]);

  if (loading) {
    return <section className="inv-operations-state"><Loader2 className="inv-spin" size={22} /> Loading procurement…</section>;
  }

  return (
    <section className="inv-procurement" data-testid={`procurement-view-${mode}`}>
      {(error || notice) && (
        <div className={`inv-banner ${error ? "inv-banner--error" : "inv-banner--success"}`}>
          {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
        </div>
      )}

      <div className="inv-procurement-toolbar">
        <div>
          <p className="inv-kicker">Procurement control</p>
          <h2>{mode === "purchase-orders" ? "Purchase Orders" : mode === "purchases" ? "Purchases & Receipts" : "Returns to Supplier"}</h2>
          <p>Branch-scoped controls linked to source evidence and the immutable inventory ledger.</p>
        </div>
        <div>
          <button className="inv-button inv-button--ghost" onClick={refresh} aria-label="Refresh procurement">
            <RefreshCw size={16} /> Refresh
          </button>
          {mode !== "purchases" && (
            <button
              className="inv-button inv-button--primary"
              disabled={!canManage}
              onClick={() => setShowCreate((value) => !value)}
            >
              <Plus size={16} /> New {mode === "purchase-orders" ? "PO" : "return"}
            </button>
          )}
        </div>
      </div>

      {showCreate && mode === "purchase-orders" && (
        <form className="inv-procurement-form" onSubmit={handleCreatePo}>
          <h3>New purchase order</h3>
          <label>Supplier<select name="supplierId" required><option value="">Select supplier</option>{reference.suppliers.map((item) => <option key={item.id} value={item.id}>{item.supplier_name}</option>)}</select></label>
          <label>Destination<select name="destinationLocationId" required><option value="">Select receiving location</option>{reference.locations.filter(({ is_default_receiving: isDefault }) => isDefault).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Reference<input name="referenceNumber" required /></label>
          <label>Expected date<input name="expectedDeliveryDate" type="date" /></label>
          <label>Expected time<input name="expectedDeliveryTime" type="time" /></label>
          <label>Business context<input name="businessContext" placeholder="Opening, event, replenishment…" /></label>
          <label className="inv-procurement-wide">Notes<textarea name="notes" rows={2} /></label>
          <div className="inv-procurement-lines inv-procurement-wide">
            <h4>Order lines</h4>
            {poLines.map((line, index) => (
              <div className="inv-procurement-line-form" key={index}>
                <select
                  aria-label={`PO line ${index + 1} item`}
                  value={line.ingredientId}
                  required
                  onChange={(event) => {
                    const ingredient = reference.ingredients.find(({ id }) => id === event.target.value);
                    setPoLines((current) => current.map((item, itemIndex) => itemIndex === index ? {
                      ...item,
                      ingredientId: event.target.value,
                      requestedUnit: ingredient?.purchasing_unit || ingredient?.base_inventory_unit || "",
                      canonicalUnit: ingredient?.base_inventory_unit || "",
                    } : item));
                  }}
                >
                  <option value="">Canonical item</option>
                  {reference.ingredients.map((item) => <option key={item.id} value={item.id}>{item.canonical_name}</option>)}
                </select>
                {["requestedQuantity", "requestedUnit", "normalizedBaseQuantity", "expectedUnitCost"].map((field) => (
                  <input
                    key={field}
                    aria-label={`PO line ${index + 1} ${field}`}
                    type={field.includes("Quantity") || field.includes("Cost") ? "number" : "text"}
                    step="any"
                    placeholder={label(field)}
                    value={line[field]}
                    required={field !== "expectedUnitCost"}
                    onChange={(event) => setPoLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: event.target.value } : item))}
                  />
                ))}
                <button type="button" className="inv-button inv-button--ghost" disabled={poLines.length === 1} onClick={() => setPoLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
              </div>
            ))}
            <button type="button" className="inv-button inv-button--ghost" onClick={() => setPoLines((current) => [...current, blankPoLine()])}>Add line</button>
          </div>
          <button className="inv-button inv-button--primary" disabled={saving}>Create draft</button>
        </form>
      )}

      {showCreate && mode === "returns" && (
        <form className="inv-procurement-form" onSubmit={handleCreateReturn}>
          <h3>Post supplier return</h3>
          <label>Supplier<select name="supplierId" required><option value="">Select supplier</option>{reference.suppliers.map((item) => <option key={item.id} value={item.id}>{item.supplier_name}</option>)}</select></label>
          <label>Return from<select name="locationId" required><option value="">Select location</option>{reference.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Original receipt<select name="originalReceiptId"><option value="">Unlinked return</option>{receipts.map((item) => <option key={item.id} value={item.id}>{item.invoice_number || item.source_reference}</option>)}</select></label>
          <label>Reference<input name="referenceNumber" required /></label>
          <label>Business date<input name="businessDate" type="date" defaultValue={todayInRiyadh()} required /></label>
          <label>Document date<input name="documentDate" type="date" /></label>
          <label>Canonical item<select name="ingredientId" required><option value="">Select item</option>{reference.ingredients.map((item) => <option key={item.id} value={item.id}>{item.canonical_name}</option>)}</select></label>
          <label>Quantity<input name="quantity" type="number" step="any" min="0" required /></label>
          <label>Reason<input name="reason" required /></label>
          <label className="inv-procurement-wide">Notes<textarea name="notes" rows={2} /></label>
          <button className="inv-button inv-button--primary" disabled={saving}>Post return</button>
        </form>
      )}

      <div className="inv-workspace">
        <aside className="inv-queue">
          {!rows.length && <p className="inv-empty">No {label(mode)} for this branch.</p>}
          {rows.map((row) => (
            <button key={row.id} className={`inv-queue-item ${selected?.id === row.id ? "is-active" : ""}`} onClick={() => setSelectedId(row.id)}>
              <span>
                <strong>{row.reference_number || row.invoice_number || row.source_reference}</strong>
                <small>{row.inventory_suppliers?.supplier_name || "Supplier"}</small>
              </span>
              <em className={`inv-status inv-status--${statusTone(row.status)}`}>{label(row.status)}</em>
            </button>
          ))}
        </aside>

        <section className="inv-review">
          {!selected ? <div className="inv-empty inv-empty--large">Select a transaction to review.</div> : (
            <>
              <div className="inv-review-heading">
                <div>
                  <p className="inv-kicker">{label(mode)}</p>
                  <h2>{selected.reference_number || selected.invoice_number || selected.source_reference}</h2>
                  <div className="inv-inline-meta">
                    <span className={`inv-status inv-status--${statusTone(selected.status)}`}>{label(selected.status)}</span>
                    <span>{selected.inventory_suppliers?.supplier_name}</span>
                    <span>{selected.business_date || selected.expected_delivery_date || selected.effective_at?.slice(0, 10) || "No date"}</span>
                  </div>
                </div>
                {mode === "purchase-orders" && nextPurchaseOrderActions(selected.status).map((action) => (
                  <button
                    key={action}
                    className="inv-button inv-button--secondary"
                    disabled={saving}
                    onClick={() => {
                      const reason = window.prompt(`Reason to mark this PO ${label(action)}:`);
                      if (reason) run(() => transitionPurchaseOrder(selected.id, action, reason), `Purchase order marked ${label(action)}.`);
                    }}
                  >
                    {label(action)}
                  </button>
                ))}
              </div>

              <div className="inv-summary">
                <article><strong>{money(selected.expected_total ?? selected.total)}</strong><span>transaction amount</span></article>
                <article><strong>{selected.inventory_purchase_order_lines?.length || selected.inventory_purchase_receipt_lines?.length || selected.inventory_supplier_return_lines?.length || 0}</strong><span>lines</span></article>
                <article className={exceptionCount ? "is-warning" : ""}><strong>{exceptionCount}</strong><span>open exceptions</span></article>
                <article><strong>{audit.length}</strong><span>audit events</span></article>
              </div>

              <section className="inv-lines">
                <h3>Transaction lines</h3>
                {(selected.inventory_purchase_order_lines || selected.inventory_purchase_receipt_lines || selected.inventory_supplier_return_lines || []).map((lineRow) => {
                  const progressRow = progress.find(({ purchase_order_line_id }) => purchase_order_line_id === lineRow.id);
                  return (
                    <article className="inv-line inv-procurement-line" key={lineRow.id}>
                      <div><span>Canonical item</span><strong>{lineRow.inventory_ingredients?.canonical_name || lineRow.original_description || "Item"}</strong><small>{lineRow.supplier_sku || "No supplier SKU"}</small></div>
                      <div><span>Source evidence</span><strong>{lineRow.source_quantity ?? lineRow.original_quantity ?? lineRow.requested_quantity} {lineRow.source_unit || lineRow.original_unit || lineRow.requested_unit}</strong><small>{lineRow.interpretation_snapshot ? "OCR snapshot retained" : "Manual source"}</small></div>
                      <div><span>Normalized</span><strong>{lineRow.normalized_quantity ?? lineRow.canonical_quantity ?? lineRow.normalized_base_quantity} {lineRow.canonical_unit}</strong><small>{money(lineRow.line_total ?? lineRow.total_cost ?? lineRow.expected_total_cost)}</small></div>
                      {progressRow && <div><span>Receipt progress</span><strong>{progressRow.received_quantity} received</strong><small>{progressRow.remaining_quantity} remaining</small></div>}
                    </article>
                  );
                })}
              </section>

              <section className="inv-exceptions">
                <h3>Audit history</h3>
                {audit.length ? audit.map((entry) => (
                  <div className="inv-exception" key={entry.id}>
                    <span><strong>{label(entry.event_type)}</strong>{entry.reason || "Recorded action"}</span>
                    <em>{new Date(entry.created_at).toLocaleString()}</em>
                  </div>
                )) : <p>No audit events available for this record.</p>}
              </section>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
