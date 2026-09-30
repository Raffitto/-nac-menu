import { buildInvoiceDocument, classifyInvoiceFile, groupInvoicePages, lineReviewState, receivingLocationAllowed } from "./documentPages";

describe("phone invoice pages", () => {
  test("rejects HEIC and accepts jpeg, png, webp, and pdf", () => {
    expect(classifyInvoiceFile({ name: "page.HEIC", type: "image/heic" }).ok).toBe(false);
    expect(classifyInvoiceFile({ name: "a.jpg", type: "image/jpeg" }).kind).toBe("image");
    expect(classifyInvoiceFile({ name: "a.png", type: "image/png" }).kind).toBe("image");
    expect(classifyInvoiceFile({ name: "a.webp", type: "image/webp" }).kind).toBe("image");
    expect(classifyInvoiceFile({ name: "a.pdf", type: "application/pdf" }).kind).toBe("pdf");
  });

  test("several photos are one invoice and a pdf is not mixed with photos", () => {
    const photos = groupInvoicePages([
      { name: "page1.jpg", type: "image/jpeg" },
      { name: "page2.png", type: "image/png" },
    ]);
    expect(photos.ok).toBe(true);
    expect(photos.pageCount).toBe(2);
    expect(photos.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(groupInvoicePages([
      { name: "invoice.pdf", type: "application/pdf" },
      { name: "extra.jpg", type: "image/jpeg" },
    ]).ok).toBe(false);
  });

  test("a single camera photo stays the original file", async () => {
    const photo = new File(["jpeg-bytes"], "image.jpg", { type: "image/jpeg" });
    await expect(buildInvoiceDocument([photo])).resolves.toBe(photo);
  });

  test("line states stay uncertain until required facts exist", () => {
    expect(lineReviewState({ original_quantity: null, unit_price: 1, original_unit: "kg" }).label).toBe("MISSING INFORMATION");
    expect(lineReviewState({
      original_quantity: 2, unit_price: 1, original_unit: "kg", review_status: "needs_review", ingredient_id: null,
    }).label).toBe("NEW ITEM");
    expect(lineReviewState({
      original_quantity: 2, unit_price: 1, original_unit: "kg", review_status: "verified", ingredient_id: "ing",
    }).label).toBe("RECOGNIZED");
  });

  test("kitchen and bar cannot receive into each other's locations", () => {
    expect(receivingLocationAllowed("kitchen_inventory_manager", "bar")).toBe(false);
    expect(receivingLocationAllowed("kitchen_inventory_manager", "kitchen")).toBe(true);
    expect(receivingLocationAllowed("bar_inventory_manager", "kitchen")).toBe(false);
    expect(receivingLocationAllowed("bar_inventory_manager", "bar")).toBe(true);
    expect(receivingLocationAllowed("super_admin", "bar")).toBe(true);
  });
});
