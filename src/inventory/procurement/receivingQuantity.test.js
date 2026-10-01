import { deriveReceiptPack, describeReceivedLine } from "./receivingQuantity";

describe("receipt pack derivation", () => {
  test("a piece item is 250 supplier units times conversion 1", () => {
    const pack = deriveReceiptPack({
      original_quantity: 250,
      original_unit: "Each",
      conversion_factor: 1,
      canonical_received_quantity: 250,
      canonical_unit: "each",
    });
    expect(pack.ok).toBe(true);
    expect(pack).toMatchObject({
      packQuantity: 250,
      packSize: 1,
      packUnit: "each",
      originalUnit: "Each",
      received: 250,
    });
    expect(describeReceivedLine({
      original_quantity: 250,
      original_unit: "Each",
      conversion_factor: 1,
      canonical_received_quantity: 250,
      canonical_unit: "each",
    })).toMatchObject({
      verified: true,
      supplier: "Supplier delivered: 250 each",
      received: "Received into inventory: 250 each",
    });
  });

  test("a packed piece item is 4 supplier units times 1000", () => {
    const pack = deriveReceiptPack({
      original_quantity: 4,
      conversion_factor: 1000,
      canonical_received_quantity: 4000,
      canonical_unit: "each",
      pack_status: "verified",
    });
    expect(pack).toMatchObject({
      ok: true,
      packQuantity: 4,
      packSize: 1000,
      packUnit: "each",
      originalUnit: "pack",
      received: 4000,
    });
    expect(describeReceivedLine({
      original_quantity: 4,
      conversion_factor: 1000,
      canonical_received_quantity: 4000,
      canonical_unit: "each",
    })).toMatchObject({
      verified: true,
      supplier: "Supplier delivered: 4 × 1000 pcs",
      received: "Received into inventory: 4000 each",
    });
  });

  test("an unknown or inconsistent conversion does not invent a pack", () => {
    expect(deriveReceiptPack({
      original_quantity: 4,
      canonical_received_quantity: 4000,
      canonical_unit: "each",
    }).ok).toBe(false);
    expect(deriveReceiptPack({
      original_quantity: 4,
      conversion_factor: 1000,
      canonical_received_quantity: 4,
      canonical_unit: "each",
    }).reason).toBe("quantity_mismatch");
    expect(describeReceivedLine({ original_quantity: 4 }).packLabel).toMatch(/Pack \?/);
  });
});
