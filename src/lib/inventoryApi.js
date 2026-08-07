import { supabase } from "./supabase";
import { buildInvoiceLineFingerprint, normalizeText } from "../inventory/inventoryIntelligence";
import { mapIngredientRow, trimIngredientName } from "../inventory/ingredientMaster";
import {
  buildFoodBibleSummary,
  dedupeMenuItems,
  deriveRecipeReadiness,
  findRecipeForMenuIdentity,
  guestMenuStatus,
  mapLineRow,
  mapRecipeRow,
  mapStageRow,
  mapVersionRow,
  normalizeRecipeType,
  READINESS,
  wouldCreateCycle,
  computeCanonicalLine,
} from "../inventory/foodBible";
import { fetchMenuCatalogueForBranch } from "./menuApi";
import {
  buildVarianceAnalysis,
  summarizeVarianceCommandCenter,
} from "../inventory/varianceIntelligence";
import { mergeTheoreticalConsumption } from "../inventory/dataReadiness";

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

async function unwrap(request, context) {
  const { data, error } = await request;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data;
}

async function currentUserId() {
  const client = requireClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw new Error(`Resolve current user: ${error.message}`);
  if (!data?.user?.id) throw new Error("Authentication required");
  return data.user.id;
}

export async function createIngredient(input) {
  const createdBy = input.createdBy || await currentUserId();
  const row = await unwrap(
    requireClient().from("inventory_ingredients").insert({
      canonical_name: trimIngredientName(input.canonicalName),
      normalized_search_name: normalizeText(input.canonicalName),
      description: input.description || null,
      category: input.category || null,
      base_inventory_unit: input.baseInventoryUnit,
      purchasing_unit: input.purchasingUnit || null,
      inventory_classification: input.inventoryClassification || "food_ingredient",
      recipe_cost_eligible: input.recipeCostEligible !== false,
      legitimate_zero_cost: input.legitimateZeroCost === true,
      yield_percentage: input.yieldPercentage || "100",
      scope: input.branchId ? "branch" : "network",
      branch_id: input.branchId || null,
      allergen_metadata: input.allergenMetadata || {},
      created_by: createdBy,
      active: input.active !== false,
    }).select().single(),
    "Create ingredient"
  );
  return mapIngredientRow(row);
}

export async function createSupplier(input) {
  const createdBy = input.createdBy || await currentUserId();
  const supplier = await unwrap(
    requireClient().from("inventory_suppliers").insert({
      supplier_name: input.name,
      normalized_name: normalizeText(input.name),
      legal_name: input.legalName || null,
      vat_number: input.vatNumber || null,
      contact_information: input.contactInformation || {},
      payment_terms: input.paymentTerms || null,
      currency: input.currency || "SAR",
      active: input.active !== false,
      created_by: createdBy,
    }).select().single(),
    "Create supplier"
  );
  if (input.branchIds?.length) {
    await unwrap(
      requireClient().from("inventory_supplier_branches").insert(
        input.branchIds.map((branchId) => ({ supplier_id: supplier.id, branch_id: branchId }))
      ),
      "Assign supplier branches"
    );
  }
  return supplier;
}

export async function createSupplierCatalogueItem(input) {
  return unwrap(
    requireClient().from("inventory_supplier_catalogue_items").insert({
      supplier_id: input.supplierId,
      supplier_sku: input.supplierSku || null,
      original_product_name: input.originalProductName,
      normalized_product_name: normalizeText(input.originalProductName),
      ingredient_id: input.ingredientId,
      purchase_unit: input.purchaseUnit,
      pack_quantity: input.packQuantity || "1",
      pack_size: input.packSize || "1",
      pack_unit: input.packUnit || input.purchaseUnit,
      conversion_factor: input.conversionFactor,
      default_tax_rate: input.defaultTaxRate || "0",
      verification_state: input.verificationState || "unverified",
      created_by: input.createdBy || await currentUserId(),
    }).select().single(),
    "Create supplier catalogue item"
  );
}

export async function verifySupplierAlias(input) {
  return unwrap(
    requireClient().rpc("inventory_verify_supplier_alias", {
      p_supplier_id: input.supplierId,
      p_catalogue_item_id: input.catalogueItemId,
      p_supplier_sku: input.supplierSku || null,
      p_original_description: input.originalDescription,
      p_reason: input.reason || "invoice_review",
    }),
    "Verify supplier alias"
  );
}

export async function hashInvoiceFile(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadInvoice({
  branchId,
  file,
  supplierId = null,
  invoiceNumber = null,
  invoiceDate = null,
  effectiveReceiptDate = null,
  currency = "SAR",
  notes = null,
  idempotencyKey,
}) {
  const client = requireClient();
  const uploaderId = await currentUserId();
  const fileHash = await hashInvoiceFile(file);
  const objectPath = `${branchId}/${fileHash}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const existing = await unwrap(
    client.from("inventory_invoices").select("*").eq("file_hash", fileHash).maybeSingle(),
    "Check duplicate invoice file"
  );
  if (existing) return { invoice: existing, duplicate: true };

  await unwrap(
    client.storage.from("inventory-invoices").upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
    }),
    "Upload source invoice"
  );

  try {
    const invoice = await unwrap(
      client.from("inventory_invoices").insert({
        branch_id: branchId,
        supplier_id: supplierId,
        source_filename: file.name,
        storage_bucket: "inventory-invoices",
        storage_path: objectPath,
        mime_type: file.type,
        file_size_bytes: file.size,
        file_hash: fileHash,
        status: "uploaded",
        ocr_status: "pending",
        processing_status: "uploaded",
        approval_status: "pending",
        uploader_id: uploaderId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        effective_receipt_date: effectiveReceiptDate || invoiceDate,
        currency,
        notes,
        idempotency_key: idempotencyKey || `upload:${branchId}:${fileHash}`,
      }).select().single(),
      "Register invoice"
    );
    return { invoice, duplicate: false };
  } catch (error) {
    await client.storage.from("inventory-invoices").remove([objectPath]);
    throw error;
  }
}

export async function triggerInvoiceOcr(invoiceId, idempotencyKey = `ocr:${invoiceId}`) {
  return unwrap(
    requireClient().functions.invoke("inventory-invoice-ocr", {
      body: { invoiceId, idempotencyKey },
    }),
    "Trigger invoice OCR"
  );
}

export async function retrieveOcrResult(invoiceId) {
  return unwrap(
    requireClient()
      .from("inventory_invoices")
      .select("*, inventory_invoice_lines(*), inventory_invoice_exceptions(*)")
      .eq("id", invoiceId)
      .single(),
    "Retrieve OCR result"
  );
}

export async function getInvoiceSourceUrl(invoice, expiresIn = 300) {
  const { signedUrl } = await unwrap(
    requireClient().storage
      .from(invoice.storage_bucket || "inventory-invoices")
      .createSignedUrl(invoice.storage_path, expiresIn),
    "Create protected invoice link"
  );
  return signedUrl;
}

export async function normalizeInvoiceHeader(invoiceId, corrections) {
  return updateInvoiceReview(invoiceId, corrections);
}

export async function normalizeInvoiceLines(invoiceId, lines) {
  const client = requireClient();
  const results = [];
  for (const line of lines) {
    results.push(await unwrap(
      client.rpc("inventory_update_invoice_line", {
        p_invoice_id: invoiceId,
        p_line_id: line.id,
        p_patch: line,
        p_reason: line.reason || "review_correction",
      }),
      "Normalize invoice line"
    ));
  }
  return results;
}

export async function generateMatchCandidates(invoiceLineId) {
  return unwrap(
    requireClient().rpc("inventory_generate_match_candidates", { p_invoice_line_id: invoiceLineId }),
    "Generate ingredient match candidates"
  );
}

export async function confirmLineMapping(input) {
  return unwrap(
    requireClient().rpc("inventory_confirm_line_mapping", {
      p_invoice_line_id: input.invoiceLineId,
      p_ingredient_id: input.ingredientId,
      p_catalogue_item_id: input.catalogueItemId || null,
      p_conversion_factor: input.conversionFactor,
      p_canonical_quantity: input.canonicalQuantity,
      p_canonical_unit: input.canonicalUnit,
      p_create_verified_alias: input.createVerifiedAlias !== false,
      p_reason: input.reason || "manual_review",
    }),
    "Confirm invoice line mapping"
  );
}

export async function updateInvoiceReview(invoiceId, patch) {
  return unwrap(
    requireClient().rpc("inventory_update_invoice_review", {
      p_invoice_id: invoiceId,
      p_patch: patch,
      p_reason: patch.reason || "review_correction",
    }),
    "Update invoice review"
  );
}

export async function approveInvoice(invoiceId, idempotencyKey = `approve:${invoiceId}`) {
  return unwrap(
    requireClient().rpc("inventory_approve_and_post_invoice", {
      p_invoice_id: invoiceId,
      p_idempotency_key: idempotencyKey,
    }),
    "Approve and post invoice"
  );
}

export const postReceipt = approveInvoice;

export async function rejectInvoice(invoiceId, reason) {
  return unwrap(
    requireClient().rpc("inventory_reject_invoice", {
      p_invoice_id: invoiceId,
      p_reason: reason,
    }),
    "Reject invoice"
  );
}

export async function acknowledgePriceVariance(alertId, reason) {
  return unwrap(
    requireClient().rpc("inventory_acknowledge_price_variance", {
      p_alert_id: alertId,
      p_reason: reason,
    }),
    "Acknowledge price variance"
  );
}

export async function resolveInvoiceException(exceptionId, reason) {
  return unwrap(
    requireClient().rpc("inventory_resolve_invoice_exception", {
      p_exception_id: exceptionId,
      p_reason: reason,
    }),
    "Resolve invoice exception"
  );
}

export async function fetchInvoiceHistory({ branchId, from, to, status }) {
  let query = requireClient().from("inventory_invoices").select("*, inventory_suppliers(supplier_name)");
  if (branchId) query = query.eq("branch_id", branchId);
  if (from) query = query.gte("invoice_date", from);
  if (to) query = query.lte("invoice_date", to);
  if (status) query = query.eq("status", status);
  return unwrap(query.order("invoice_date", { ascending: false }), "Fetch invoice history");
}

export async function fetchInventoryReferenceData(branchId) {
  const client = requireClient();
  const [ingredients, suppliers, locations] = await Promise.all([
    unwrap(
      client
        .from("inventory_ingredients")
        .select("*")
        .eq("active", true)
        .or(`branch_id.is.null,branch_id.eq.${branchId}`)
        .order("canonical_name"),
      "Fetch ingredients"
    ),
    unwrap(
      client
        .from("inventory_suppliers")
        .select("*, inventory_supplier_branches!inner(branch_id, active)")
        .eq("active", true)
        .eq("inventory_supplier_branches.branch_id", branchId)
        .eq("inventory_supplier_branches.active", true)
        .order("supplier_name"),
      "Fetch suppliers"
    ),
    unwrap(
      client
        .from("inventory_storage_locations")
        .select("*")
        .eq("branch_id", branchId)
        .eq("active", true)
        .order("name"),
      "Fetch storage locations"
    ),
  ]);
  return { ingredients, suppliers, locations };
}

export async function fetchReceiptHistory({ branchId, supplierId, from, to }) {
  let query = requireClient().from("inventory_purchase_receipts").select(`
    *,
    inventory_suppliers(supplier_name),
    inventory_invoices(invoice_number, invoice_date, source_filename, storage_bucket, storage_path),
    inventory_purchase_orders(reference_number, status),
    inventory_purchase_receipt_lines(
      *,
      inventory_ingredients(canonical_name),
      inventory_purchase_order_lines(line_number, normalized_base_quantity, canonical_unit)
    )
  `);
  if (branchId) query = query.eq("branch_id", branchId);
  if (supplierId) query = query.eq("supplier_id", supplierId);
  if (from) query = query.gte("effective_at", from);
  if (to) query = query.lte("effective_at", to);
  return unwrap(query.order("effective_at", { ascending: false }), "Fetch receipt history");
}

export async function fetchPurchaseOrders({ branchId, status } = {}) {
  let query = requireClient().from("inventory_purchase_orders").select(`
    *,
    inventory_suppliers(supplier_name),
    destination:inventory_storage_locations!destination_location_id(name),
    inventory_purchase_order_lines(
      *,
      inventory_ingredients(canonical_name)
    )
  `);
  if (branchId) query = query.eq("branch_id", branchId);
  if (status) query = query.eq("status", status);
  return unwrap(query.order("created_at", { ascending: false }), "Fetch purchase orders");
}

export async function fetchPurchaseOrderProgress(purchaseOrderId) {
  return unwrap(
    requireClient()
      .from("inventory_purchase_order_progress")
      .select("*")
      .eq("purchase_order_id", purchaseOrderId)
      .order("line_number"),
    "Fetch purchase order progress"
  );
}

export async function createPurchaseOrder(payload) {
  return unwrap(
    requireClient().rpc("inventory_create_purchase_order", {
      p_payload: {
        branchId: payload.branchId,
        supplierId: payload.supplierId,
        destinationLocationId: payload.destinationLocationId,
        referenceNumber: payload.referenceNumber,
        businessContext: payload.businessContext || null,
        expectedDeliveryDate: payload.expectedDeliveryDate || null,
        expectedDeliveryTime: payload.expectedDeliveryTime || null,
        notes: payload.notes || null,
        currency: payload.currency || "SAR",
      },
      p_lines: payload.lines,
      p_idempotency_key: payload.idempotencyKey || `purchase-order:${payload.branchId}:${crypto.randomUUID()}`,
    }),
    "Create purchase order"
  );
}

export async function transitionPurchaseOrder(purchaseOrderId, targetStatus, reason) {
  return unwrap(
    requireClient().rpc("inventory_transition_purchase_order", {
      p_purchase_order_id: purchaseOrderId,
      p_target_status: targetStatus,
      p_reason: reason,
    }),
    "Transition purchase order"
  );
}

export async function linkInvoicePurchaseOrder({
  invoiceId,
  purchaseOrderId = null,
  additionalCost = 0,
  reason = "invoice_intake_receiving_control",
}) {
  return unwrap(
    requireClient().rpc("inventory_link_invoice_purchase_order", {
      p_invoice_id: invoiceId,
      p_purchase_order_id: purchaseOrderId,
      p_additional_cost: additionalCost || 0,
      p_reason: reason,
    }),
    "Link invoice to purchase order"
  );
}

export async function fetchSupplierReturns({ branchId, supplierId } = {}) {
  let query = requireClient().from("inventory_supplier_returns").select(`
    *,
    inventory_suppliers(supplier_name),
    inventory_purchase_orders(reference_number),
    inventory_purchase_receipts(source_reference, invoice_number),
    inventory_supplier_return_lines(
      *,
      inventory_ingredients(canonical_name)
    )
  `);
  if (branchId) query = query.eq("branch_id", branchId);
  if (supplierId) query = query.eq("supplier_id", supplierId);
  return unwrap(query.order("business_date", { ascending: false }), "Fetch supplier returns");
}

export async function postSupplierReturn(payload) {
  return unwrap(
    requireClient().rpc("inventory_post_supplier_return", {
      p_payload: {
        branchId: payload.branchId,
        supplierId: payload.supplierId,
        locationId: payload.locationId,
        originalReceiptId: payload.originalReceiptId || null,
        purchaseOrderId: payload.purchaseOrderId || null,
        referenceNumber: payload.referenceNumber,
        businessDate: payload.businessDate,
        documentDate: payload.documentDate || null,
        effectiveAt: payload.effectiveAt || `${payload.businessDate}T12:00:00+03:00`,
        reason: payload.reason,
        notes: payload.notes || null,
        evidence: payload.evidence || {},
      },
      p_lines: payload.lines,
      p_idempotency_key: payload.idempotencyKey || `supplier-return:${payload.branchId}:${crypto.randomUUID()}`,
    }),
    "Post supplier return"
  );
}

export async function fetchInventoryAuditTrail({ entityType, entityId }) {
  let query = requireClient()
    .from("inventory_audit_log")
    .select("*")
    .eq("entity_type", entityType)
    .order("created_at", { ascending: false });
  if (entityId) query = query.eq("entity_id", entityId);
  return unwrap(query, "Fetch inventory audit trail");
}

export async function fetchInventoryBalance({ branchId, locationId, ingredientId }) {
  let query = requireClient().from("inventory_current_stock").select("*").eq("branch_id", branchId);
  if (locationId) query = query.eq("storage_location_id", locationId);
  if (ingredientId) query = query.eq("ingredient_id", ingredientId);
  return unwrap(query, "Fetch inventory balance");
}

export async function fetchStockAsOf({ branchId, asOf, locationId = null, ingredientId = null }) {
  return unwrap(
    requireClient().rpc("inventory_stock_as_of", {
      p_branch_id: branchId,
      p_as_of: asOf,
      p_storage_location_id: locationId,
      p_ingredient_id: ingredientId,
    }),
    "Fetch historical stock"
  );
}

export async function fetchCostHistory({ branchId, ingredientId, from = null, to = null }) {
  let query = requireClient()
    .from("inventory_ingredient_cost_history")
    .select("*")
    .eq("branch_id", branchId)
    .eq("ingredient_id", ingredientId);
  if (from) query = query.gte("effective_at", from);
  if (to) query = query.lte("effective_at", to);
  return unwrap(query.order("effective_at", { ascending: false }), "Fetch cost history");
}

export async function fetchSupplierPriceHistory({ supplierId, ingredientId = null, branchId = null }) {
  let query = requireClient()
    .from("inventory_ingredient_cost_history")
    .select("*")
    .eq("supplier_id", supplierId);
  if (ingredientId) query = query.eq("ingredient_id", ingredientId);
  if (branchId) query = query.eq("branch_id", branchId);
  return unwrap(query.order("effective_at", { ascending: false }), "Fetch supplier price history");
}

export async function fetchRecipeCost({ recipeId, asOf = null }) {
  return unwrap(
    requireClient().rpc("inventory_recipe_cost_as_of", { p_recipe_id: recipeId, p_as_of: asOf }),
    "Fetch recipe cost"
  );
}

export async function fetchMenuItemMargin({ menuItemId, branchId, asOf = null }) {
  return unwrap(
    requireClient().rpc("inventory_menu_margin_as_of", {
      p_menu_item_id: menuItemId,
      p_branch_id: branchId,
      p_as_of: asOf,
    }),
    "Fetch menu item margin"
  );
}

async function createMovement(action, payload) {
  return unwrap(
    requireClient().rpc("inventory_create_operational_movement", {
      p_action: action,
      p_payload: payload,
      p_idempotency_key: payload.idempotencyKey,
    }),
    `Create ${action} movement`
  );
}

export const createOperationalEvent = (action, payload) => createMovement(action, payload);

export async function fetchOperationalEvents({ branchId, eventType = null, from = null, to = null }) {
  let query = requireClient()
    .from("inventory_operational_events")
    .select("*, inventory_operational_event_lines(*)")
    .eq("branch_id", branchId);
  if (eventType) query = query.eq("event_type", eventType);
  if (from) query = query.gte("business_date", from);
  if (to) query = query.lte("business_date", to);
  return unwrap(query.order("business_date", { ascending: false }), "Fetch operational events");
}

export async function fetchInventoryExceptions({ branchId, status = "open" }) {
  let query = requireClient()
    .from("inventory_exceptions")
    .select("*, inventory_ingredients(canonical_name)")
    .eq("branch_id", branchId);
  if (status) query = query.eq("status", status);
  return unwrap(query.order("detected_at", { ascending: false }), "Fetch inventory exceptions");
}

export async function resolveInventoryException(exceptionId, status, reason) {
  return unwrap(
    requireClient().rpc("inventory_resolve_exception", {
      p_exception_id: exceptionId,
      p_status: status,
      p_reason: reason,
    }),
    "Resolve inventory exception",
  );
}

export const createWastage = (payload) => createMovement("wastage", payload);
export const createDisposal = (payload) => createMovement("disposal", payload);
export const createOperationalUse = (payload) => createMovement("operational_use", payload);
export const createManualAdjustment = (payload) => createMovement("manual_adjustment", payload);
export const createReturnToSupplier = (payload) => createMovement("return_to_supplier", payload);
export const createStaffMeal = (payload) => createMovement("staff_meal", payload);
export const createComplimentaryUsage = (payload) => createMovement("complimentary", payload);
export const createProductionMovement = (payload) => createMovement("production", payload);
export const createProductionConsumption = (payload) => createMovement("production_consumption", payload);
export const createProductionOutput = (payload) => createMovement("production_output", payload);
export const createProductionWaste = (payload) => createMovement("production_waste", payload);
export const createOrderConsumption = (payload) => createMovement("order_consumption", payload);
export const createOrderWaste = (payload) => createMovement("order_waste", payload);
export const createSpoilage = (payload) => createMovement("spoilage", payload);
export const createBreakage = (payload) => createMovement("breakage", payload);
export const createComplimentaryInternalUse = (payload) => createMovement("complimentary_internal_use", payload);

export async function createTransfer(payload) {
  return unwrap(
    requireClient().rpc("inventory_create_transfer_request", {
      p_payload: payload,
      p_lines: payload.lines || [],
      p_idempotency_key: payload.idempotencyKey,
    }),
    "Create inventory transfer"
  );
}

export async function fetchTransfers(branchId) {
  return unwrap(
    requireClient()
      .from("inventory_transfers")
      .select("*, inventory_transfer_lines(*)")
      .or(`source_branch_id.eq.${branchId},destination_branch_id.eq.${branchId}`)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false }),
    "Fetch inventory transfers",
  );
}

export async function transitionTransfer(transferId, status, reason) {
  return unwrap(
    requireClient().rpc("inventory_transition_transfer", {
      p_transfer_id: transferId,
      p_target_status: status,
      p_reason: reason,
    }),
    "Transition inventory transfer",
  );
}

export async function dispatchTransfer(transferId, lines, reason, idempotencyKey) {
  return unwrap(
    requireClient().rpc("inventory_dispatch_transfer", {
      p_transfer_id: transferId,
      p_sent_lines: lines,
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
    }),
    "Dispatch inventory transfer",
  );
}

export async function receiveTransfer(transferId, lines, reason, idempotencyKey) {
  return unwrap(
    requireClient().rpc("inventory_receive_transfer", {
      p_transfer_id: transferId,
      p_received_lines: lines,
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
    }),
    "Receive inventory transfer",
  );
}

export async function reverseOrCorrectMovement({ movementId, quantity, reason, idempotencyKey }) {
  return unwrap(
    requireClient().rpc("inventory_reverse_movement", {
      p_movement_id: movementId,
      p_corrected_quantity: quantity ?? null,
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
    }),
    "Reverse or correct movement"
  );
}

export async function createStockCount(payload) {
  const userId = payload.createdBy || await currentUserId();
  const count = await unwrap(
    requireClient().from("inventory_stock_counts").insert({
      branch_id: payload.branchId,
      storage_location_id: payload.locationId,
      effective_at: payload.effectiveAt,
      business_date: payload.businessDate || String(payload.effectiveAt).slice(0, 10),
      status: "draft",
      created_by: userId,
      counted_by: payload.countedBy || userId,
      idempotency_key: payload.idempotencyKey,
      evidence_metadata: payload.evidence || {},
      notes: payload.notes || null,
    }).select().single(),
    "Create stock count"
  );
  if (payload.lines?.length) {
    await unwrap(
      requireClient().from("inventory_stock_count_lines").insert(
        payload.lines.map((line) => ({
          stock_count_id: count.id,
          ingredient_id: line.ingredientId,
          expected_quantity: line.expectedQuantity,
          counted_quantity: line.countedQuantity,
          canonical_unit: line.canonicalUnit,
          source_counted_quantity: line.sourceCountedQuantity || line.countedQuantity,
          source_count_unit: line.sourceCountUnit || line.canonicalUnit,
          conversion_factor: line.conversionFactor || "1",
          expected_snapshot_at: line.expectedSnapshotAt || payload.effectiveAt,
          evidence_metadata: line.evidence || {},
          notes: line.notes || null,
        }))
      ),
      "Create stock count lines"
    );
  }
  return count;
}

export async function confirmStockCountWarning(lineId, reason) {
  return unwrap(
    requireClient().rpc("inventory_confirm_count_warning", {
      p_count_line_id: lineId,
      p_reason: reason,
    }),
    "Confirm unusual stock count",
  );
}

export async function submitStockCount(countId) {
  return unwrap(
    requireClient().rpc("inventory_submit_stock_count", { p_count_id: countId }),
    "Submit stock count",
  );
}

export async function approveStockCount(countId, idempotencyKey = `stock-count:${countId}`) {
  await submitStockCount(countId);
  return unwrap(
    requireClient().rpc("inventory_approve_stock_count", {
      p_count_id: countId,
      p_idempotency_key: idempotencyKey,
    }),
    "Approve stock count"
  );
}

export async function fetchCountSessions(branchId) {
  return unwrap(
    requireClient()
      .from("inventory_count_sessions")
      .select("*")
      .eq("branch_id", branchId)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false }),
    "Fetch stock count sessions",
  );
}

export async function fetchCountSessionDetails(sessionId) {
  const [session, counts, totals] = await Promise.all([
    unwrap(
      requireClient().from("inventory_count_sessions").select("*").eq("id", sessionId).single(),
      "Fetch stock count session",
    ),
    unwrap(
      requireClient()
        .from("inventory_stock_counts")
        .select("*, inventory_stock_count_lines(*)")
        .eq("count_session_id", sessionId)
        .order("created_at"),
      "Fetch location counts",
    ),
    unwrap(
      requireClient()
        .from("inventory_count_session_item_totals")
        .select("*")
        .eq("count_session_id", sessionId),
      "Fetch count session totals",
    ),
  ]);
  return { ...session, counts, totals };
}

export async function createCountSession(payload) {
  return unwrap(
    requireClient().rpc("inventory_create_count_session", {
      p_payload: payload,
      p_location_ids: payload.locationIds || [],
      p_idempotency_key: payload.idempotencyKey,
    }),
    "Create stock count session",
  );
}

export async function saveCountSessionLine(stockCountId, payload) {
  return unwrap(
    requireClient().rpc("inventory_save_count_session_line", {
      p_stock_count_id: stockCountId,
      p_payload: payload,
    }),
    "Save stock count line",
  );
}

export async function transitionCountSession(sessionId, status, reason, idempotencyKey = null) {
  return unwrap(
    requireClient().rpc("inventory_transition_count_session", {
      p_count_session_id: sessionId,
      p_target_status: status,
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
    }),
    "Transition stock count session",
  );
}

export async function fetchIngredients({ branchId, includeInactive = true } = {}) {
  let query = requireClient()
    .from("inventory_ingredients")
    .select("*")
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)
    .order("canonical_name");
  if (!includeInactive) query = query.eq("active", true);
  const rows = await unwrap(query, "Fetch ingredients");
  return rows.map(mapIngredientRow);
}

export async function fetchIngredientById(ingredientId) {
  const row = await unwrap(
    requireClient().from("inventory_ingredients").select("*").eq("id", ingredientId).maybeSingle(),
    "Fetch ingredient",
  );
  return mapIngredientRow(row);
}

export async function findDuplicateIngredient({
  canonicalName,
  branchId = null,
  scope = "branch",
  excludeId = null,
}) {
  const normalized = normalizeText(trimIngredientName(canonicalName));
  if (!normalized) return null;
  let query = requireClient()
    .from("inventory_ingredients")
    .select("id, canonical_name, active, scope, branch_id")
    .eq("normalized_search_name", normalized);
  if (scope === "network") {
    query = query.eq("scope", "network").is("branch_id", null);
  } else {
    query = query.eq("scope", "branch").eq("branch_id", branchId);
  }
  if (excludeId) query = query.neq("id", excludeId);
  return unwrap(query.maybeSingle(), "Check duplicate ingredient name");
}

export async function fetchIngredientDependencySummary(ingredientId) {
  const client = requireClient();
  const [movements, catalogue, receipts] = await Promise.all([
    client
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("ingredient_id", ingredientId)
      .eq("status", "posted"),
    client
      .from("inventory_supplier_catalogue_items")
      .select("id", { count: "exact", head: true })
      .eq("ingredient_id", ingredientId),
    client
      .from("inventory_purchase_receipt_lines")
      .select("id", { count: "exact", head: true })
      .eq("ingredient_id", ingredientId),
  ]);
  if (movements.error) throw new Error(`Check ingredient movements: ${movements.error.message}`);
  if (catalogue.error) throw new Error(`Check supplier catalogue links: ${catalogue.error.message}`);
  if (receipts.error) throw new Error(`Check purchase receipts: ${receipts.error.message}`);
  const movementCount = movements.count || 0;
  const catalogueCount = catalogue.count || 0;
  const receiptCount = receipts.count || 0;
  return {
    movementCount,
    catalogueCount,
    receiptCount,
    hasDependencies: movementCount + catalogueCount + receiptCount > 0,
  };
}

export async function updateIngredient(ingredientId, input) {
  const patch = {
    updated_at: new Date().toISOString(),
  };
  if (input.canonicalName != null) {
    patch.canonical_name = trimIngredientName(input.canonicalName);
    patch.normalized_search_name = normalizeText(patch.canonical_name);
  }
  if (input.category !== undefined) patch.category = input.category || null;
  if (input.baseInventoryUnit != null) patch.base_inventory_unit = input.baseInventoryUnit;
  if (input.inventoryClassification != null) patch.inventory_classification = input.inventoryClassification;
  if (input.recipeCostEligible != null) patch.recipe_cost_eligible = Boolean(input.recipeCostEligible);
  if (input.legitimateZeroCost != null) patch.legitimate_zero_cost = Boolean(input.legitimateZeroCost);
  if (input.description !== undefined) patch.description = input.description || null;
  if (input.active != null) patch.active = Boolean(input.active);
  const row = await unwrap(
    requireClient().from("inventory_ingredients").update(patch).eq("id", ingredientId).select().single(),
    "Update ingredient",
  );
  return mapIngredientRow(row);
}

export async function setIngredientActive(ingredientId, active) {
  return updateIngredient(ingredientId, { active });
}

export async function fetchRecipes({ branchId, includeInactive = false } = {}) {
  let query = requireClient()
    .from("inventory_recipes")
    .select("*")
    .or(`branch_id.is.null,branch_id.eq.${branchId}`)
    .order("name");
  if (!includeInactive) query = query.eq("active", true);
  const rows = await unwrap(query, "Fetch recipes");
  return rows.map(mapRecipeRow);
}

async function fetchRecipeVersions(recipeIds) {
  if (!recipeIds.length) return [];
  return unwrap(
    requireClient()
      .from("inventory_recipe_versions")
      .select("*")
      .in("recipe_id", recipeIds)
      .order("version_number", { ascending: false }),
    "Fetch recipe versions",
  );
}

async function fetchRecipeLines(versionIds) {
  if (!versionIds.length) return [];
  return unwrap(
    requireClient()
      .from("inventory_recipe_version_lines")
      .select("*")
      .in("recipe_version_id", versionIds)
      .order("sort_order"),
    "Fetch recipe lines",
  );
}

async function fetchRecipeStages(versionIds) {
  if (!versionIds.length) return [];
  return unwrap(
    requireClient()
      .from("inventory_recipe_stages")
      .select("*")
      .in("recipe_version_id", versionIds)
      .order("sort_order"),
    "Fetch recipe stages",
  );
}

function pickWorkingVersion(versions, recipeId) {
  const recipeVersions = versions.filter((version) => version.recipe_id === recipeId);
  return recipeVersions.find((version) => version.status === "draft")
    || recipeVersions[0]
    || null;
}

export async function fetchRecipeBundle(recipeId) {
  const row = await unwrap(
    requireClient().from("inventory_recipes").select("*").eq("id", recipeId).maybeSingle(),
    "Fetch recipe",
  );
  if (!row) return null;
  const recipe = mapRecipeRow(row);
  const versions = await fetchRecipeVersions([recipeId]);
  const versionRow = pickWorkingVersion(versions, recipeId);
  const version = mapVersionRow(versionRow);
  const versionId = version?.id;
  const [lineRows, stageRows] = versionId
    ? await Promise.all([fetchRecipeLines([versionId]), fetchRecipeStages([versionId])])
    : [[], []];
  return {
    recipe,
    version,
    lines: lineRows.map(mapLineRow),
    stages: stageRows.map(mapStageRow),
  };
}

export async function fetchRecipeUsageCounts(recipeIds = []) {
  if (!recipeIds.length) return {};
  const lines = await unwrap(
    requireClient()
      .from("inventory_recipe_version_lines")
      .select("sub_recipe_id, recipe_version_id")
      .in("sub_recipe_id", recipeIds),
    "Fetch recipe usage",
  );
  const counts = Object.fromEntries(recipeIds.map((id) => [id, 0]));
  for (const line of lines || []) {
    if (line.sub_recipe_id) counts[line.sub_recipe_id] = (counts[line.sub_recipe_id] || 0) + 1;
  }
  return counts;
}

export async function fetchFoodBibleOverview({ branchId, asOf = new Date().toISOString().slice(0, 10) }) {
  const [{ data: menuData, error: menuError }, recipeRows, ingredientRows, costHealth] = await Promise.all([
    fetchMenuCatalogueForBranch({ branchId }),
    fetchRecipes({ branchId, includeInactive: true }),
    fetchIngredients({ branchId, includeInactive: true }),
    fetchInventoryCostHealth({ branchId, asOf }),
  ]);
  if (menuError) throw new Error(`Fetch menu for Food Bible: ${menuError.message}`);

  const recipes = recipeRows.map((recipe) => ({
    ...recipe,
    recipeType: normalizeRecipeType(recipe.recipeType),
  }));
  const recipeIds = recipes.map((recipe) => recipe.id);
  const versions = await fetchRecipeVersions(recipeIds);
  const versionByRecipe = new Map();
  for (const recipeId of recipeIds) {
    versionByRecipe.set(recipeId, mapVersionRow(pickWorkingVersion(versions, recipeId)));
  }
  const versionIds = [...versionByRecipe.values()].filter(Boolean).map((version) => version.id);
  const lineRows = await fetchRecipeLines(versionIds);
  const linesByVersion = new Map();
  for (const line of lineRows.map(mapLineRow)) {
    const bucket = linesByVersion.get(line.recipeVersionId) || [];
    bucket.push(line);
    linesByVersion.set(line.recipeVersionId, bucket);
  }

  const ingredientById = new Map(ingredientRows.map((ingredient) => [ingredient.id, ingredient]));
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const sectionById = Object.fromEntries((menuData?.sections || []).map((section) => [section.id, section]));
  const categoryById = Object.fromEntries((menuData?.categories || []).map((category) => [category.id, category]));
  const menuItemById = Object.fromEntries((menuData?.items || []).map((item) => [item.id, item]));
  const productCostByMenuItemId = new Map(
    (costHealth?.products || []).map((product) => [product.menuItemId, product]),
  );
  const productCostByRecipeId = new Map(
    (costHealth?.products || []).filter((product) => product.recipeId).map((product) => [product.recipeId, product]),
  );
  for (const recipeCost of costHealth?.recipes || []) {
    if (!productCostByRecipeId.has(recipeCost.recipeId)) {
      productCostByRecipeId.set(recipeCost.recipeId, {
        recipeId: recipeCost.recipeId,
        recipeCost: recipeCost.totalCost,
        costPerSoldPortion: recipeCost.costPerPortion ?? recipeCost.outputUnitCost,
        costCompletenessPct: recipeCost.completenessPct,
        costConfidencePct: recipeCost.confidencePct,
        costTrustStatus: recipeCost.trustStatus,
        costStatus: recipeCost.costStatus,
        profitabilityAvailable: recipeCost.profitabilityAvailable,
        missingComponents: recipeCost.missingComponents,
        warnings: recipeCost.warnings,
      });
    }
  }

  const allLinesByRecipeId = {};
  for (const recipe of recipes) {
    const version = versionByRecipe.get(recipe.id);
    allLinesByRecipeId[recipe.id] = version ? (linesByVersion.get(version.id) || []) : [];
  }

  const identities = dedupeMenuItems(menuData?.items || []);
  const menuLinkedRecipeIds = new Set();
  const rows = identities.map((identity) => {
    const recipe = findRecipeForMenuIdentity(recipes, identity);
    if (recipe) menuLinkedRecipeIds.add(recipe.id);
    const version = recipe ? versionByRecipe.get(recipe.id) : null;
    const lines = version ? (linesByVersion.get(version.id) || []) : [];
    const cycleDetected = recipe
      ? wouldCreateCycle(recipe.id, null, allLinesByRecipeId)
      : false;
    const readinessResult = recipe
      ? deriveRecipeReadiness({
        recipe,
        version,
        lines,
        ingredientById,
        recipeById,
        menuItem: menuItemById[recipe?.menuItemId || identity.primaryItem.id],
        cycleDetected,
      })
      : { readiness: READINESS.MISSING, checklist: [], issues: [] };
    const section = sectionById[identity.primaryItem.section_id];
    const category = categoryById[section?.category_id];
    const productCost = productCostByMenuItemId.get(identity.primaryItem.id)
      || (recipe ? productCostByRecipeId.get(recipe.id) : null);
    return {
      kind: "menu_item",
      identityKey: identity.identityKey,
      displayName: identity.primaryItem.name_en,
      displayNameAr: identity.primaryItem.name_ar,
      recipeName: recipe?.name || null,
      internalName: recipe?.internalName || null,
      recipeType: recipe?.recipeType || "menu_item",
      recipeId: recipe?.id || null,
      menuItemId: identity.primaryItem.id,
      placementGroupId: identity.placementGroupId,
      placements: identity.placements,
      categoryName: category?.name_en || "Uncategorised",
      guestStatus: guestMenuStatus(identity.primaryItem),
      readiness: readinessResult.readiness,
      lineCount: lines.length,
      yieldSummary: recipe ? `${recipe.outputQuantity || "—"} ${recipe.outputUnit || ""}` : "—",
      scope: recipe?.scope || "branch",
      updatedAt: recipe?.updatedAt || null,
      cost: productCost || null,
      costTrustStatus: productCost?.costTrustStatus || "UNRELIABLE",
      costCompletenessPct: productCost?.costCompletenessPct ?? 0,
    };
  });

  for (const recipe of recipes) {
    if (menuLinkedRecipeIds.has(recipe.id)) continue;
    if (recipe.recipeType === "menu_item" || recipe.recipeType === "direct_stock") continue;
    const version = versionByRecipe.get(recipe.id);
    const lines = version ? (linesByVersion.get(version.id) || []) : [];
    const readinessResult = deriveRecipeReadiness({
      recipe,
      version,
      lines,
      ingredientById,
      recipeById,
      menuItem: recipe.menuItemId ? menuItemById[recipe.menuItemId] : null,
      cycleDetected: wouldCreateCycle(recipe.id, null, allLinesByRecipeId),
    });
    const productCost = productCostByRecipeId.get(recipe.id) || null;
    rows.push({
      kind: "component",
      identityKey: recipe.id,
      displayName: recipe.name,
      displayNameAr: recipe.nameAr,
      recipeName: recipe.name,
      internalName: recipe.internalName,
      recipeType: recipe.recipeType,
      recipeId: recipe.id,
      menuItemId: recipe.menuItemId,
      placementGroupId: recipe.placementGroupId,
      placements: [],
      categoryName: "Kitchen components",
      guestStatus: null,
      readiness: readinessResult.readiness,
      lineCount: lines.length,
      yieldSummary: `${recipe.outputQuantity || "—"} ${recipe.outputUnit || ""}`,
      scope: recipe.scope,
      updatedAt: recipe.updatedAt,
      cost: productCost,
      costTrustStatus: productCost?.costTrustStatus || "UNRELIABLE",
      costCompletenessPct: productCost?.costCompletenessPct ?? 0,
    });
  }

  return {
    summary: buildFoodBibleSummary(rows),
    rows,
    ingredients: ingredientRows,
    recipes,
    costHealth,
    costAsOf: asOf,
    hasActiveIngredients: ingredientRows.some((ingredient) => ingredient.active),
    lineGraph: allLinesByRecipeId,
  };
}

export async function createRecipe(input) {
  const userId = await currentUserId();
  const branchId = input.scope === "network" ? null : input.branchId;
  const recipeRow = await unwrap(
    requireClient().from("inventory_recipes").insert({
      name: input.name.trim(),
      normalized_name: normalizeText(input.name),
      name_en: input.nameEn?.trim() || null,
      name_ar: input.nameAr?.trim() || null,
      internal_name: input.internalName?.trim() || null,
      recipe_type: input.recipeType,
      menu_item_id: input.menuItemId || null,
      placement_group_id: input.placementGroupId || null,
      branch_id: branchId,
      output_quantity: input.outputQuantity,
      output_unit: input.outputUnit,
      portion_count: input.portionCount || null,
      portion_size: input.portionSize || null,
      portion_unit: input.portionUnit || null,
      created_by: userId,
      updated_by: userId,
      active: true,
    }).select().single(),
    "Create recipe",
  );
  const versionRow = await unwrap(
    requireClient().from("inventory_recipe_versions").insert({
      recipe_id: recipeRow.id,
      version_number: 1,
      effective_from: new Date().toISOString(),
      status: "draft",
      output_quantity: input.outputQuantity,
      output_unit: input.outputUnit,
      portion_count: input.portionCount || null,
      portion_size: input.portionSize || null,
      portion_unit: input.portionUnit || null,
      documentation: input.documentation || {},
      created_by: userId,
      updated_by: userId,
    }).select().single(),
    "Create recipe version",
  );
  return {
    recipe: mapRecipeRow(recipeRow),
    version: mapVersionRow(versionRow),
    lines: [],
    stages: [],
  };
}

export async function saveRecipeDraft(recipeId, payload) {
  const userId = await currentUserId();
  const client = requireClient();
  const recipePatch = {
    name: payload.name?.trim(),
    normalized_name: normalizeText(payload.name),
    name_en: payload.nameEn?.trim() || null,
    name_ar: payload.nameAr?.trim() || null,
    internal_name: payload.internalName?.trim() || null,
    recipe_type: payload.recipeType,
    menu_item_id: payload.menuItemId || null,
    placement_group_id: payload.placementGroupId || null,
    output_quantity: payload.outputQuantity,
    output_unit: payload.outputUnit,
    portion_count: payload.portionCount || null,
    portion_size: payload.portionSize || null,
    portion_unit: payload.portionUnit || null,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  if (payload.scope != null) {
    recipePatch.branch_id = payload.scope === "network" ? null : payload.branchId;
  }
  await unwrap(
    client.from("inventory_recipes").update(recipePatch).eq("id", recipeId).select().single(),
    "Update recipe",
  );

  let version = payload.version;
  if (version?.id && version.status !== "draft") {
    const versionRow = await unwrap(
      client.rpc("inventory_prepare_recipe_draft_version", {
        p_recipe_id: recipeId,
        p_documentation: payload.documentation || {},
      }),
      "Prepare recipe draft version",
    );
    version = mapVersionRow(versionRow);
  }
  if (!version?.id) {
    const versionRow = await unwrap(
      client.from("inventory_recipe_versions").insert({
        recipe_id: recipeId,
        version_number: 1,
        effective_from: new Date().toISOString(),
        status: "draft",
        output_quantity: payload.outputQuantity,
        output_unit: payload.outputUnit,
        portion_count: payload.portionCount || null,
        portion_size: payload.portionSize || null,
        portion_unit: payload.portionUnit || null,
        documentation: payload.documentation || {},
        created_by: userId,
        updated_by: userId,
      }).select().single(),
      "Create recipe version",
    );
    version = mapVersionRow(versionRow);
  } else {
    const versionRow = await unwrap(
      client.from("inventory_recipe_versions").update({
        output_quantity: payload.outputQuantity,
        output_unit: payload.outputUnit,
        portion_count: payload.portionCount || null,
        portion_size: payload.portionSize || null,
        portion_unit: payload.portionUnit || null,
        documentation: payload.documentation || {},
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }).eq("id", version.id).select().single(),
      "Update recipe version",
    );
    version = mapVersionRow(versionRow);
  }

  await unwrap(
    client.from("inventory_recipe_stages").delete().eq("recipe_version_id", version.id),
    "Clear recipe stages",
  );
  await unwrap(
    client.from("inventory_recipe_version_lines").delete().eq("recipe_version_id", version.id),
    "Clear recipe lines",
  );

  const stageIdMap = new Map();
  for (const [index, stage] of (payload.stages || []).entries()) {
    const stageRow = await unwrap(
      client.from("inventory_recipe_stages").insert({
        recipe_version_id: version.id,
        name: stage.name.trim(),
        sort_order: index,
      }).select().single(),
      "Create recipe stage",
    );
    stageIdMap.set(stage.clientId || stage.id, stageRow.id);
  }

  const ingredientById = new Map((payload.ingredients || []).map((ingredient) => [ingredient.id, ingredient]));
  for (const [index, line] of (payload.lines || []).entries()) {
    if (!line.ingredientId && !line.subRecipeId) continue;
    const canonical = line.ingredientId
      ? computeCanonicalLine(line, ingredientById)
      : {
        canonicalQuantity: line.quantity,
        canonicalUnit: line.unit,
        yieldWasteFactor: 1 + (Number(line.wastePercentage || 0) / 100),
      };
    await unwrap(
      client.from("inventory_recipe_version_lines").insert({
        recipe_version_id: version.id,
        ingredient_id: line.ingredientId || null,
        sub_recipe_id: line.subRecipeId || null,
        quantity: line.quantity,
        unit: line.unit,
        canonical_quantity: canonical.canonicalQuantity,
        canonical_unit: canonical.canonicalUnit,
        yield_waste_factor: canonical.yieldWasteFactor,
        preparation_note: line.preparationNote || null,
        is_optional: Boolean(line.isOptional),
        waste_percentage: line.wastePercentage || 0,
        sort_order: index,
        stage_id: stageIdMap.get(line.stageId) || line.stageId || null,
      }),
      "Create recipe line",
    );
  }

  return fetchRecipeBundle(recipeId);
}

export async function fetchRecipeCostTrust({
  recipeId,
  branchId,
  asOf = new Date().toISOString().slice(0, 10),
  recipeVersionId = null,
  staleAfterDays = 90,
}) {
  return unwrap(
    requireClient().rpc("inventory_recipe_cost_trust_as_of", {
      p_recipe_id: recipeId,
      p_branch_id: branchId,
      p_as_of: asOf,
      p_recipe_version_id: recipeVersionId,
      p_stale_after_days: staleAfterDays,
    }),
    "Fetch recipe cost trust",
  );
}

export async function fetchProductCostTrust({
  menuItemId,
  branchId,
  asOf = new Date().toISOString().slice(0, 10),
  staleAfterDays = 90,
}) {
  return unwrap(
    requireClient().rpc("inventory_product_cost_trust_as_of", {
      p_menu_item_id: menuItemId,
      p_branch_id: branchId,
      p_as_of: asOf,
      p_stale_after_days: staleAfterDays,
    }),
    "Fetch product cost trust",
  );
}

export async function fetchInventoryCostHealth({
  branchId,
  asOf = new Date().toISOString().slice(0, 10),
  staleAfterDays = 90,
}) {
  return unwrap(
    requireClient().rpc("inventory_cost_health_as_of", {
      p_branch_id: branchId,
      p_as_of: asOf,
      p_stale_after_days: staleAfterDays,
    }),
    "Fetch inventory cost health",
  );
}

export async function fetchInventoryVarianceAnalysis({
  branchId,
  periodStart,
  periodEnd,
  ingredientId = null,
  staleCostDays = 90,
  materiality,
}) {
  const [rawVariance, theoretical] = await Promise.all([
    unwrap(
      requireClient().rpc("inventory_variance_analysis", {
        p_branch_id: branchId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_ingredient_id: ingredientId,
        p_stale_cost_days: staleCostDays,
      }),
      "Fetch inventory variance analysis",
    ),
    fetchInventoryTheoreticalConsumption({
      branchId,
      periodStart,
      periodEnd,
    }).catch(() => null),
  ]);
  const result = mergeTheoreticalConsumption(rawVariance, theoretical);
  const items = (result?.items || []).map((item) => buildVarianceAnalysis(item, materiality));
  return {
    ...result,
    items,
    summary: summarizeVarianceCommandCenter(items),
  };
}

export async function fetchInventoryDataReadiness({ branchId, asOf }) {
  return unwrap(
    requireClient().rpc("inventory_data_readiness_overview", {
      p_branch_id: branchId,
      p_as_of: asOf,
    }),
    "Fetch inventory data readiness",
  );
}

export async function setMenuItemCostingIntent({
  branchId,
  menuItemId,
  costingIntent,
  reason,
  evidence = {},
}) {
  return unwrap(
    requireClient().rpc("inventory_set_menu_item_costing_intent", {
      p_branch_id: branchId,
      p_menu_item_id: menuItemId,
      p_costing_intent: costingIntent,
      p_reason: reason,
      p_evidence: evidence,
    }),
    "Confirm menu-item costing intent",
  );
}

export async function reviewSalesConsumptionBatch({
  batchId,
  status,
  quantitySemantics,
  reason,
  sourceMetadata = {},
}) {
  return unwrap(
    requireClient().rpc("inventory_review_sales_consumption_batch", {
      p_batch_id: batchId,
      p_status: status,
      p_quantity_semantics: quantitySemantics,
      p_reason: reason,
      p_source_metadata: sourceMetadata,
    }),
    "Review sales consumption source",
  );
}

export async function linkMenuItemRecipe({
  branchId,
  menuItemId,
  recipeId,
  reason,
}) {
  return unwrap(
    requireClient().rpc("inventory_link_menu_item_recipe", {
      p_branch_id: branchId,
      p_menu_item_id: menuItemId,
      p_recipe_id: recipeId,
      p_reason: reason,
    }),
    "Link menu item to recipe",
  );
}

export async function createInventoryItemFromInvoiceCandidate({
  invoiceLineId,
  payload,
  reason,
}) {
  return unwrap(
    requireClient().rpc("inventory_create_item_from_invoice_candidate", {
      p_invoice_line_id: invoiceLineId,
      p_payload: payload,
      p_reason: reason,
    }),
    "Create canonical item from supplier source",
  );
}

export async function fetchInventoryTheoreticalConsumption({
  branchId,
  periodStart,
  periodEnd,
}) {
  return unwrap(
    requireClient().rpc("inventory_theoretical_consumption", {
      p_branch_id: branchId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    }),
    "Fetch theoretical inventory consumption",
  );
}

export async function setInventoryVarianceReview({
  branchId,
  ingredientId,
  periodStart,
  periodEnd,
  status,
  reason,
  correctiveReference = {},
  countSessionId = null,
  stockCountId = null,
}) {
  return unwrap(
    requireClient().rpc("inventory_set_variance_review", {
      p_branch_id: branchId,
      p_ingredient_id: ingredientId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_status: status,
      p_reason: reason,
      p_corrective_reference: correctiveReference,
      p_count_session_id: countSessionId,
      p_stock_count_id: stockCountId,
    }),
    "Update inventory variance review",
  );
}

export async function activateRecipeVersion({
  recipeVersionId,
  effectiveFrom,
  reason,
}) {
  return unwrap(
    requireClient().rpc("inventory_activate_recipe_version", {
      p_recipe_version_id: recipeVersionId,
      p_effective_from: effectiveFrom,
      p_reason: reason,
    }),
    "Activate recipe version",
  );
}

export async function setRecipeActive(recipeId, active) {
  const userId = await currentUserId();
  const row = await unwrap(
    requireClient().from("inventory_recipes").update({
      active: Boolean(active),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    }).eq("id", recipeId).select().single(),
    "Update recipe status",
  );
  return mapRecipeRow(row);
}

export async function fetchInventoryStaffAccess() {
  const client = requireClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(`Resolve current user: ${authError.message}`);
  const email = authData?.user?.email?.toLowerCase();
  if (!email) {
    return {
      email: null,
      vaultRole: null,
      primaryBranchId: null,
      branchIds: [],
    };
  }

  const staff = await unwrap(
    client.from("ask_nac_staff").select("vault_role, primary_branch_id").ilike("email", email).maybeSingle(),
    "Fetch inventory staff access",
  );

  const branchRows = await unwrap(
    client.from("ask_nac_user_branch_access").select("branch_id").ilike("email", email),
    "Fetch inventory branch access",
  );

  const branchIds = [
    ...new Set(
      [staff?.primary_branch_id, ...(branchRows || []).map((row) => row.branch_id)].filter(Boolean),
    ),
  ];

  return {
    email,
    vaultRole: staff?.vault_role || null,
    primaryBranchId: staff?.primary_branch_id || null,
    branchIds,
  };
}

export function invoiceLineFingerprint(lines) {
  return buildInvoiceLineFingerprint(lines);
}
