import React, { useEffect, useMemo, useState } from "react";
import {
  assessReceivingLine,
  RECEIVING_STAGE,
  receivingIdempotencyKey,
} from "./automation/receivingDocument";
import { canManageBranchIngredients, CANONICAL_UNITS } from "./ingredientMaster";
import {
  fetchInventoryReferenceData,
  fetchInventoryStaffAccess,
  fetchReceiptHistory,
} from "../lib/inventoryApi";

function historyKeys(receipts) {
  const keys = [];
  for (const receipt of receipts || []) {
    for (const line of receipt.inventory_purchase_receipt_lines || []) {
      keys.push(receivingIdempotencyKey({
        branchId: receipt.branch_id,
        supplierId: receipt.supplier_id,
        deliveryReference: receipt.source_reference,
        ingredientId: line.ingredient_id,
        unit: line.canonical_unit,
      }));
    }
  }
  return keys;
}

export default function ManagerReceivingView({ branchId }) {
  const [access, setAccess] = useState(null);
  const [ingredients, setIngredients] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lines, setLines] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [deliveryReference, setDeliveryReference] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [orderedQuantity, setOrderedQuantity] = useState("");
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [unit, setUnit] = useState("each");

  useEffect(() => {
    let cancelled = false;
    setError("");
    Promise.all([
      fetchInventoryStaffAccess(),
      fetchInventoryReferenceData(branchId),
      fetchReceiptHistory({ branchId }),
    ]).then(([staff, reference, receipts]) => {
      if (cancelled) return;
      setAccess(staff);
      setIngredients(reference.ingredients || []);
      setSuppliers(reference.suppliers || []);
      setHistory(receipts || []);
    }).catch((err) => {
      if (!cancelled) setError(err.message || "Could not load receiving.");
    });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const canRecord = canManageBranchIngredients(access, branchId);
  const existingKeys = useMemo(
    () => [...historyKeys(history), ...lines.map((line) => line.key)],
    [history, lines],
  );

  function addLine(event) {
    event.preventDefault();
    setNotice("");
    const draft = {
      branchId,
      supplierId,
      deliveryReference: deliveryReference.trim(),
      ingredientId,
      unit,
      orderedQuantity: orderedQuantity === "" ? null : orderedQuantity,
      receivedQuantity,
      stage: RECEIVING_STAGE.RECEIVED,
    };
    const assessment = assessReceivingLine(draft, { allowedBranchId: branchId, existingKeys });
    if (!assessment.ok) {
      setNotice(assessment.reason);
      return;
    }
    const ingredient = ingredients.find((row) => row.id === ingredientId);
    setLines((current) => [...current, {
      ...draft,
      ...assessment,
      name: ingredient?.canonical_name || "Ingredient",
    }]);
    setReceivedQuantity("");
    setOrderedQuantity("");
  }

  return (
    <section className="inv-receive" data-testid="manager-receiving">
      <h2>Receive a delivery</h2>
      <p>Preview the delivery for this branch. Nothing is posted to stock from this screen.</p>
      {error ? <p role="alert">{error}</p> : null}
      {!access ? <p>Loading receiving…</p> : null}
      {access && !canRecord ? (
        <p role="status">You can view this branch, but you cannot record a delivery.</p>
      ) : null}
      {canRecord ? (
        <form className="inv-receive-form" onSubmit={addLine}>
          <label>
            Supplier
            <select aria-label="Supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              <option value="">Choose a supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}</option>
              ))}
            </select>
          </label>
          <label>
            Delivery reference
            <input
              aria-label="Delivery reference"
              value={deliveryReference}
              onChange={(event) => setDeliveryReference(event.target.value)}
              required
            />
          </label>
          <label>
            Ingredient
            <select aria-label="Ingredient" value={ingredientId} onChange={(event) => setIngredientId(event.target.value)} required>
              <option value="">Choose an ingredient</option>
              {ingredients.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>{ingredient.canonical_name}</option>
              ))}
            </select>
          </label>
          <label>
            Unit
            <select aria-label="Unit" value={unit} onChange={(event) => setUnit(event.target.value)}>
              {CANONICAL_UNITS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Ordered quantity
            <input
              aria-label="Ordered quantity"
              inputMode="decimal"
              value={orderedQuantity}
              onChange={(event) => setOrderedQuantity(event.target.value)}
            />
          </label>
          <label>
            Received quantity
            <input
              aria-label="Received quantity"
              inputMode="decimal"
              value={receivedQuantity}
              onChange={(event) => setReceivedQuantity(event.target.value)}
              required
            />
          </label>
          <button className="inv-button" type="submit">Add to delivery</button>
        </form>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}

      <section data-testid="receiving-preview">
        <h3>Preview</h3>
        <p>Nothing is posted.</p>
        {lines.length === 0 ? <p>No lines yet.</p> : (
          <ul>
            {lines.map((line) => (
              <li key={line.key}>
                {line.name}: received {line.receivedQuantity} {line.unit}
                {line.partial ? " · partial" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="receiving-history">
        <h3>Receiving history</h3>
        {history.length === 0 ? <p>No posted receipts for this branch.</p> : (
          <ul>
            {history.map((receipt) => (
              <li key={receipt.id}>
                {receipt.source_reference} · {receipt.status}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
