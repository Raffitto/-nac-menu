/**
 * Source adapters feed NAC canonical commerce. Replacing Foodics later
 * should only require a new adapter, not new Ask NAC semantics.
 */

export const FOODICS_ADAPTER = {
  source: "foodics" as const,
  authority: "LEGACY_EXTERNAL_EVIDENCE" as const,
  currentlyAutomatedReports: ["sales_by_creator", "menu_engineering"] as const,
  officialOrderExport: {
    ui: "Orders → Export → Orders | Order Items",
    maxDays: 31,
    listFiltersDoNotApply: true,
    delivery: "async email (export-api/v2/orders and export-api/v2/orders-items)",
    sampleCsvDownloaded: false,
  },
  validatedConsoleOrderResource: {
    getting: "/core-api/getting?url=/orders&id={uuid}",
    listing: "/core-api/listing?url=/orders",
    stableOrderId: "data.id UUID",
    stableOrderItemId: "data.products[].id UUID",
    stableProductId: "data.products[].product.id UUID",
    guestsField: "data.guests",
    dineInType: 1,
    doneStatus: 4,
    sampleOrderId: "78aeffe9-589d-4e95-92c4-47e9e4fd3661",
  },
  canEmitCanonicalOrders: true,
  canEmitCanonicalOrderItems: true,
  canEmitDineInSessions: true,
  branchesObserved: ["khobar"] as const,
  blocker:
    "Official Orders/Order Items CSV is often async-email. Mailbox polling is an external-access blocker unless IMAP credentials exist. Authenticated console read is the approved fallback and converges on the same RawSourceBatch contract.",
};

export const FUTURE_NAC_POS_ADAPTER = {
  source: "nac_pos" as const,
  authority: "CANONICAL" as const,
  canEmitCanonicalOrders: true,
  canEmitCanonicalOrderItems: true,
  canEmitDineInSessions: true,
};
