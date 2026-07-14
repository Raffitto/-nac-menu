import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import { createInvoiceOcrProvider } from "../_shared/inventoryInvoiceOcr.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseDecimal(value: unknown) {
  const raw = String(value ?? "0").replace(/,/g, "").trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) throw new Error(`Invalid decimal: ${value}`);
  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return {
    coefficient: BigInt(`${whole || "0"}${fraction}` || "0") * (negative ? -1n : 1n),
    scale: fraction.length,
  };
}

function pow10(scale: number) {
  return 10n ** BigInt(scale);
}

function decimalString(coefficient: bigint, scale: number) {
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function add(left: unknown, right: unknown) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  return decimalString(
    a.coefficient * pow10(scale - a.scale) + b.coefficient * pow10(scale - b.scale),
    scale
  );
}

function subtract(left: unknown, right: unknown) {
  const b = parseDecimal(right);
  return add(left, decimalString(-b.coefficient, b.scale));
}

function multiply(left: unknown, right: unknown) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  return decimalString(a.coefficient * b.coefficient, a.scale + b.scale);
}

function compare(left: unknown, right: unknown) {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const av = a.coefficient * pow10(scale - a.scale);
  const bv = b.coefficient * pow10(scale - b.scale);
  return av === bv ? 0 : av > bv ? 1 : -1;
}

function absolute(value: unknown) {
  const parsed = parseDecimal(value);
  return decimalString(parsed.coefficient < 0n ? -parsed.coefficient : parsed.coefficient, parsed.scale);
}

async function lineFingerprint(lines: any[]) {
  const source = lines.map((line) => [
    normalizeText(line.supplierSku),
    normalizeText(line.originalDescription),
    decimalString(parseDecimal(line.quantity || "0").coefficient, parseDecimal(line.quantity || "0").scale),
    normalizeText(line.unit),
    decimalString(parseDecimal(line.lineTotal || "0").coefficient, parseDecimal(line.lineTotal || "0").scale),
  ].join("|")).sort().join("::");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type ExceptionInput = {
  invoice_id: string;
  invoice_line_id?: string | null;
  exception_type: string;
  severity: "warning" | "review" | "blocking";
  message: string;
  details?: Record<string, unknown>;
};

function validateHeader(invoiceId: string, extracted: any): ExceptionInput[] {
  const exceptions: ExceptionInput[] = [];
  const addException = (
    exception_type: string,
    severity: ExceptionInput["severity"],
    message: string,
    details: Record<string, unknown> = {}
  ) => exceptions.push({ invoice_id: invoiceId, exception_type, severity, message, details });

  if (!extracted.supplierName) addException("supplier_ambiguity", "blocking", "Supplier was not identified");
  if (!extracted.invoiceDate || Number.isNaN(Date.parse(extracted.invoiceDate))) {
    addException("invalid_or_missing_invoice_date", "blocking", "Invoice date is missing or invalid");
  }
  if (String(extracted.currency || "").toUpperCase() !== "SAR") {
    addException("unsupported_currency", "blocking", `Unsupported currency: ${extracted.currency || "missing"}`);
  }
  if (extracted.confidence < 0.85) {
    addException("low_ocr_confidence", "review", "OCR confidence is below 85%", {
      confidence: extracted.confidence,
    });
  }
  if (extracted.subtotal != null && extracted.total != null) {
    const expected = subtract(add(extracted.subtotal, extracted.tax || "0"), extracted.discount || "0");
    if (compare(absolute(subtract(expected, extracted.total)), "0.05") > 0) {
      addException("invoice_total_mismatch", "review", "Subtotal + tax − discount does not match total", {
        expected,
        extracted: extracted.total,
      });
    }
  }
  return exceptions;
}

function validateLine(invoiceId: string, lineId: string, line: any): ExceptionInput[] {
  const exceptions: ExceptionInput[] = [];
  const addException = (
    exception_type: string,
    severity: ExceptionInput["severity"],
    message: string,
    details: Record<string, unknown> = {}
  ) => exceptions.push({
    invoice_id: invoiceId,
    invoice_line_id: lineId,
    exception_type,
    severity,
    message,
    details,
  });
  if (line.quantity == null || compare(line.quantity, "0") < 0) {
    addException("negative_or_missing_quantity", "blocking", "Quantity is missing or negative");
  }
  if (!line.unit) addException("unit_ambiguity", "blocking", "Invoice unit is missing");
  if (line.lineTotal == null || compare(line.lineTotal, "0") === 0) {
    addException("zero_value_line", "review", "Line total is missing or zero");
  }
  if (line.quantity != null && line.unitPrice != null && line.lineTotal != null) {
    const expected = subtract(
      add(multiply(line.quantity, line.unitPrice), line.taxAmount || "0"),
      line.lineDiscount || "0"
    );
    if (compare(absolute(subtract(expected, line.lineTotal)), "0.05") > 0) {
      addException("line_total_mismatch", "review", "Quantity × price does not match line total", {
        expected,
        extracted: line.lineTotal,
      });
    }
  }
  if (line.taxRate != null && (compare(line.taxRate, "0") < 0 || compare(line.taxRate, "100") > 0)) {
    addException("abnormal_tax", "review", "Tax rate is outside 0–100%");
  }
  return exceptions;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, { error: "Supabase Edge environment is not configured" });
  }
  if (!authorization?.startsWith("Bearer ")) return json(401, { error: "Authentication required" });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Invalid authentication" });

  let invoiceId: string | null = null;
  let requestId: string | null = null;
  try {
    const body = await req.json();
    invoiceId = String(body?.invoiceId || "");
    const idempotencyKey = String(body?.idempotencyKey || `ocr:${invoiceId}`);
    if (!invoiceId) return json(400, { error: "invoiceId is required" });

    const { data: invoice, error: invoiceError } = await userClient
      .from("inventory_invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invoiceError || !invoice) return json(404, { error: "Invoice not found or access denied" });
    if (!["uploaded", "ocr_failed", "ocr_processing"].includes(invoice.status)) {
      return json(200, {
        status: "already_processed",
        invoiceId,
        requestId: null,
        idempotent: true,
      });
    }

    const { data: existingRequest } = await serviceClient
      .from("inventory_ocr_requests")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingRequest?.status === "completed") {
      return json(200, {
        status: "already_processed",
        invoiceId,
        requestId: existingRequest.id,
        idempotent: true,
      });
    }

    if (existingRequest) {
      requestId = existingRequest.id;
      await serviceClient.from("inventory_ocr_requests").update({
        status: "processing",
        attempt_count: existingRequest.attempt_count + 1,
        started_at: new Date().toISOString(),
        error_details: null,
      }).eq("id", requestId);
    } else {
      const { data: createdRequest, error: requestError } = await serviceClient
        .from("inventory_ocr_requests")
        .insert({
          invoice_id: invoiceId,
          idempotency_key: idempotencyKey,
          status: "processing",
          attempt_count: 1,
          requested_by: userData.user.id,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (requestError) throw requestError;
      requestId = createdRequest.id;
    }

    await serviceClient.from("inventory_invoices").update({
      status: "ocr_processing",
      ocr_status: "processing",
      processing_status: "processing",
      failure_details: null,
    }).eq("id", invoiceId);

    const { data: sourceBlob, error: downloadError } = await serviceClient.storage
      .from(invoice.storage_bucket)
      .download(invoice.storage_path);
    if (downloadError || !sourceBlob) throw downloadError || new Error("Invoice source file is unavailable");

    const provider = createInvoiceOcrProvider();
    const extraction = await provider.extractInvoice({
      bytes: new Uint8Array(await sourceBlob.arrayBuffer()),
      mimeType: invoice.mime_type,
      filename: invoice.source_filename,
    });
    const extracted = extraction.invoice;
    const fingerprint = await lineFingerprint(extracted.lines);

    const { data: supplierCandidates, error: suppliersError } = await serviceClient
      .from("inventory_suppliers")
      .select("id, supplier_name, normalized_name, vat_number")
      .eq("active", true);
    if (suppliersError) throw suppliersError;
    const normalizedSupplier = normalizeText(extracted.supplierName);
    const supplier = (supplierCandidates || []).find((candidate: any) =>
      (extracted.supplierVatNumber && candidate.vat_number === extracted.supplierVatNumber) ||
      candidate.normalized_name === normalizedSupplier
    ) || null;

    await serviceClient.from("inventory_invoice_lines").delete().eq("invoice_id", invoiceId);
    await serviceClient.from("inventory_invoice_exceptions").delete().eq("invoice_id", invoiceId);

    const headerExceptions = validateHeader(invoiceId, extracted);
    if (!supplier) {
      headerExceptions.push({
        invoice_id: invoiceId,
        exception_type: "supplier_ambiguity",
        severity: "blocking",
        message: "Extracted supplier does not exactly match a verified NAC supplier",
        details: { extractedSupplierName: extracted.supplierName, vatNumber: extracted.supplierVatNumber },
      });
    } else {
      // Candidate generation reads the invoice supplier. Persist the deterministic
      // exact-name/VAT match before asking the database matcher to rank line items.
      const { error: supplierUpdateError } = await serviceClient
        .from("inventory_invoices")
        .update({ supplier_id: supplier.id })
        .eq("id", invoiceId);
      if (supplierUpdateError) throw supplierUpdateError;
    }

    const lineRows = extracted.lines.map((line) => ({
      invoice_id: invoiceId,
      line_number: line.lineNumber,
      page_number: line.pageNumber || null,
      original_description: line.originalDescription,
      normalized_description: normalizeText(line.originalDescription),
      supplier_sku: line.supplierSku,
      original_quantity: line.quantity,
      original_unit: line.unit,
      pack_quantity: line.packQuantity,
      pack_size: line.packSize,
      pack_unit: line.packUnit,
      unit_price: line.unitPrice,
      line_discount: line.lineDiscount || "0",
      tax_rate: line.taxRate,
      tax_amount: line.taxAmount || "0",
      line_total: line.lineTotal,
      ocr_confidence: line.confidence,
      evidence: line.evidence || [],
      review_status: "pending",
    }));
    const { data: insertedLines, error: linesError } = await serviceClient
      .from("inventory_invoice_lines")
      .insert(lineRows)
      .select();
    if (linesError) throw linesError;

    const exceptions = [...headerExceptions];
    for (let index = 0; index < (insertedLines || []).length; index += 1) {
      const inserted = insertedLines[index];
      const extractedLine = extracted.lines[index];
      exceptions.push(...validateLine(invoiceId, inserted.id, extractedLine));
      if (!supplier) continue;
      const { data: candidates, error: candidateError } = await userClient.rpc(
        "inventory_generate_match_candidates",
        { p_invoice_line_id: inserted.id }
      );
      if (candidateError) throw candidateError;
      const best = candidates?.[0];
      if (best?.confidence >= 0.95) {
        const { data: catalogueItem } = await serviceClient
          .from("inventory_supplier_catalogue_items")
          .select("conversion_factor, ingredient_id, pack_quantity, pack_size, pack_unit, purchase_unit")
          .eq("id", best.supplierCatalogueItemId)
          .single();
        const quantity = extractedLine.quantity;
        if (catalogueItem?.conversion_factor && quantity) {
          const canonicalQuantity = multiply(quantity, catalogueItem.conversion_factor);
          const { data: ingredient } = await serviceClient
            .from("inventory_ingredients")
            .select("base_inventory_unit")
            .eq("id", catalogueItem.ingredient_id)
            .single();
          await serviceClient.from("inventory_invoice_lines").update({
            ingredient_id: catalogueItem.ingredient_id,
            supplier_catalogue_item_id: best.supplierCatalogueItemId,
            original_unit: extractedLine.unit || catalogueItem.purchase_unit,
            pack_quantity: extractedLine.packQuantity || catalogueItem.pack_quantity,
            pack_size: extractedLine.packSize || catalogueItem.pack_size,
            pack_unit: extractedLine.packUnit || catalogueItem.pack_unit,
            conversion_factor: catalogueItem.conversion_factor,
            canonical_received_quantity: canonicalQuantity,
            canonical_unit: ingredient?.base_inventory_unit,
            matching_confidence: best.confidence,
            match_method: best.method,
            review_status: "auto_matched",
          }).eq("id", inserted.id);
        } else {
          exceptions.push({
            invoice_id: invoiceId,
            invoice_line_id: inserted.id,
            exception_type: "pack_size_ambiguity",
            severity: "blocking",
            message: "Verified match has no usable conversion",
          });
        }
      } else {
        exceptions.push({
          invoice_id: invoiceId,
          invoice_line_id: inserted.id,
          exception_type: best ? "low_match_confidence" : "unknown_ingredient",
          severity: "blocking",
          message: best
            ? `Ingredient match confidence ${(best.confidence * 100).toFixed(1)}% requires review`
            : "No ingredient match candidate was found",
          details: { candidates: candidates || [] },
        });
        await serviceClient.from("inventory_invoice_lines")
          .update({ review_status: "needs_review" })
          .eq("id", inserted.id);
      }
    }

    const duplicates: any[] = [];
    if (supplier && extracted.invoiceNumber) {
      const { data } = await serviceClient.from("inventory_invoices")
        .select("id")
        .eq("supplier_id", supplier.id)
        .eq("invoice_number", extracted.invoiceNumber)
        .neq("id", invoiceId)
        .limit(5);
      duplicates.push(...(data || []));
    }
    if (duplicates.length) {
      exceptions.push({
        invoice_id: invoiceId,
        exception_type: "duplicate_invoice_number",
        severity: "blocking",
        message: "Supplier invoice number already exists",
        details: { candidateInvoiceIds: duplicates.map(({ id }) => id) },
      });
    }
    if (exceptions.length) {
      const { error: exceptionError } = await serviceClient
        .from("inventory_invoice_exceptions")
        .insert(exceptions);
      if (exceptionError) throw exceptionError;
    }

    const status = exceptions.length ? "needs_review" : "extracted";
    const now = new Date().toISOString();
    const { error: updateError } = await serviceClient.from("inventory_invoices").update({
      supplier_id: supplier?.id || invoice.supplier_id,
      invoice_number: extracted.invoiceNumber,
      invoice_date: extracted.invoiceDate,
      delivery_date: extracted.deliveryDate,
      effective_receipt_date: extracted.deliveryDate || extracted.invoiceDate,
      purchase_order_reference: extracted.purchaseOrderNumber,
      currency: extracted.currency || invoice.currency,
      subtotal: extracted.subtotal,
      discount: extracted.discount || "0",
      tax: extracted.tax || "0",
      total: extracted.total,
      raw_ocr_text: extracted.rawText,
      structured_extraction: extracted,
      ocr_evidence: extracted.evidence,
      ocr_confidence: extracted.confidence,
      ocr_provider: extraction.provider,
      ocr_model_version: extraction.modelVersion,
      ocr_provider_metadata: extraction.providerMetadata,
      ocr_processed_at: extraction.processedAt,
      status,
      ocr_status: "completed",
      processing_status: status,
      approval_status: status === "needs_review" ? "needs_review" : "pending",
      duplicate_status: duplicates.length ? "warning" : "clear",
      line_fingerprint: fingerprint,
    }).eq("id", invoiceId);
    if (updateError) throw updateError;

    await serviceClient.from("inventory_ocr_requests").update({
      provider: extraction.provider,
      model_version: extraction.modelVersion,
      status: "completed",
      completed_at: now,
    }).eq("id", requestId);
    await serviceClient.from("inventory_audit_log").insert({
      event_type: "ocr_completed",
      actor_id: userData.user.id,
      branch_id: invoice.branch_id,
      entity_type: "invoice",
      entity_id: invoiceId,
      new_value: {
        provider: extraction.provider,
        modelVersion: extraction.modelVersion,
        confidence: extracted.confidence,
        lineCount: extracted.lines.length,
        exceptionCount: exceptions.length,
      },
      source: "inventory-invoice-ocr",
    });
    return json(200, {
      status,
      invoiceId,
      requestId,
      lineCount: extracted.lines.length,
      exceptionCount: exceptions.length,
      supplierMatched: Boolean(supplier),
      idempotent: false,
    });
  } catch (error) {
    const message = String((error as any)?.message || error || "OCR processing failed").slice(0, 500);
    if (requestId) {
      await serviceClient.from("inventory_ocr_requests").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_details: { message },
      }).eq("id", requestId);
    }
    if (invoiceId) {
      await serviceClient.from("inventory_invoices").update({
        status: "ocr_failed",
        ocr_status: "failed",
        processing_status: "failed",
        failure_details: { message },
      }).eq("id", invoiceId);
      await serviceClient.from("inventory_audit_log").insert({
        event_type: "ocr_failed",
        actor_id: userData.user.id,
        entity_type: "invoice",
        entity_id: invoiceId,
        source: "inventory-invoice-ocr",
        reason: message,
      });
    }
    return json(500, { error: message, invoiceId, requestId });
  }
});
