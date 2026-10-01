/**
 * One conversion model:
 * supplier quantity × verified conversion = canonical received quantity.
 * pack_quantity is the count of supplier units.
 * pack_size is the canonical units inside one supplier unit.
 * This matches inventory_derive_receipt_pack in Postgres.
 */

function quantity(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function deriveReceiptPack(line = {}) {
  const supplierQuantity = quantity(line.original_quantity ?? line.originalQuantity);
  const conversion = quantity(line.conversion_factor ?? line.conversionFactor);
  const received = quantity(line.canonical_received_quantity ?? line.canonicalReceivedQuantity ?? line.canonical_quantity);
  const canonicalUnit = line.canonical_unit || line.canonicalUnit || null;
  if (supplierQuantity == null || supplierQuantity <= 0 || conversion == null || conversion <= 0 || received == null || received <= 0 || !canonicalUnit) {
    return { ok: false, reason: "conversion_required" };
  }
  if (Math.abs(supplierQuantity * conversion - received) > 0.0000001) {
    return { ok: false, reason: "quantity_mismatch" };
  }
  const storedPackQuantity = quantity(line.pack_quantity ?? line.packQuantity);
  const storedPackSize = quantity(line.pack_size ?? line.packSize);
  if (storedPackQuantity != null && storedPackSize != null && Math.abs(storedPackQuantity * storedPackSize - received) > 0.0000001) {
    return { ok: false, reason: "pack_mismatch" };
  }
  return {
    ok: true,
    supplierQuantity,
    conversion,
    received,
    canonicalUnit,
    packQuantity: storedPackQuantity ?? supplierQuantity,
    packSize: storedPackSize ?? conversion,
    packUnit: line.pack_unit || line.packUnit || canonicalUnit,
    originalUnit: line.original_unit || line.originalUnit || (conversion === 1 ? canonicalUnit : "pack"),
  };
}

export function describeReceivedLine(line = {}) {
  const pack = deriveReceiptPack(line);
  if (!pack.ok) {
    return {
      verified: false,
      supplier: null,
      received: null,
      packLabel: `Pack ${line.pack_quantity ?? "?"} × ${line.pack_size ?? "?"} ${line.pack_unit || ""}`.trim(),
    };
  }
  const supplier = pack.conversion === 1
    ? `Supplier delivered: ${pack.supplierQuantity} ${pack.canonicalUnit}`
    : `Supplier delivered: ${pack.supplierQuantity} × ${pack.conversion} pcs`;
  return {
    verified: true,
    supplier,
    received: `Received into inventory: ${pack.received} ${pack.canonicalUnit}`,
    packLabel: null,
  };
}
