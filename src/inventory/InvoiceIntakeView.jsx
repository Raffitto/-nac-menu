import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  LogOut,
  RefreshCw,
  ScanLine,
  Upload,
  XCircle,
} from "lucide-react";
import NacAnalyticsSignIn from "../dashboard/components/NacAnalyticsSignIn";
import { usePlatformSession } from "../dashboard/hooks/usePlatformSession";
import { supabase } from "../lib/supabase";
import {
  approveInvoice,
  confirmLineMapping,
  confirmLinePack,
  createIngredient,
  assignHumanCode,
  updateReceivedQuantity,
  fetchInventoryReferenceData,
  fetchInvoiceHistory,
  generateMatchCandidates,
  getInvoiceSourceUrl,
  rejectInvoice,
  resolveInvoiceException,
  retrieveOcrResult,
  reconcileInvoiceExceptions,
  triggerInvoiceOcr,
  updateInvoiceReview,
  uploadInvoice,
} from "../lib/inventoryApi";
import InvoiceOnboarding from "./InvoiceOnboarding";
import { triageInvoice } from "./procurement/inboxTriage";
import { classifyPostOutcome, humanizePostError, isAmbiguousPostError } from "./procurement/postOutcome";
import { isOperationalReceivingLocation } from "./procurement/receivingReadiness";
import { resolveReceivingLocation } from "./procurement/receivingLocation";
import { createActionLock } from "../lib/nacActionGuard";
import {
  classifyDocumentKind,
  resolvePriceRequirement,
  suggestCodeFamily,
} from "./procurement/receivingPolicy";
import { buildInvoiceDocument, groupInvoicePages, lineReviewState } from "./procurement/documentPages";
import {
  invoiceCaptureError,
  invoiceCaptureFailureMessage,
  invoiceNeedsExtraction,
  uploadStageLabel,
} from "./procurement/captureFailure";
import { CANONICAL_UNITS } from "./ingredientMaster";
import "./invoice-intake.css";

const BRANCHES = [
  { id: "khobar", label: "Khobar" },
  { id: "riyadh", label: "Riyadh" },
  { id: "jeddah", label: "Jeddah" },
];

const FINAL_STATUSES = new Set(["posted", "rejected", "duplicate", "cancelled"]);

function branchFromLocation() {
  if (typeof window === "undefined") return "khobar";
  const requested = new URLSearchParams(window.location.search).get("branch");
  return BRANCHES.some(({ id }) => id === requested) ? requested : "khobar";
}

function statusTone(status) {
  if (status === "posted") return "success";
  if (["needs_review", "ocr_failed", "duplicate"].includes(status)) return "warning";
  if (["rejected", "cancelled"].includes(status)) return "danger";
  return "neutral";
}

function money(value, currency = "SAR") {
  if (value == null || value === "") return "—";
  return `${Number(value).toFixed(2)} ${currency}`;
}

const CODE_FAMILIES = [
  ["F", "Food"],
  ["B", "Bar"],
  ["C", "Consumable"],
  ["CL", "Cleaning"],
  ["P", "Packaging"],
  ["E", "Equipment"],
  ["M", "Maintenance"],
];

function ingredientLabel(ingredient) {
  if (!ingredient) return "Canonical ingredient required";
  const code = ingredient.human_code ? `${ingredient.human_code} ` : "";
  return `${code}${ingredient.canonical_name}`;
}

function confidence(value) {
  if (value == null) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export default function InvoiceIntakeView({
  embedded = false,
  branchId: branchIdProp,
  setBranchId: setBranchIdProp,
} = {}) {
  const { session, checked, issue } = usePlatformSession();
  const [internalBranchId, setInternalBranchId] = useState(branchFromLocation);
  const branchId = embedded && branchIdProp != null ? branchIdProp : internalBranchId;
  const setBranchId = embedded && setBranchIdProp ? setBranchIdProp : setInternalBranchId;
  const [invoices, setInvoices] = useState([]);
  const [reference, setReference] = useState({ ingredients: [], suppliers: [], locations: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [postedReceipt, setPostedReceipt] = useState(null);
  const [postPhase, setPostPhase] = useState("idle");
  const [postMessage, setPostMessage] = useState("");
  const postLockRef = useRef(null);
  if (!postLockRef.current) postLockRef.current = createActionLock();
  const [pages, setPages] = useState([]);
  const [uploadSupplierId, setUploadSupplierId] = useState("");
  const [uploadStage, setUploadStage] = useState("");
  const [uploadFailed, setUploadFailed] = useState(false);

  const refreshList = useCallback(async () => {
    if (!session) return;
    const [invoiceRows, referenceData] = await Promise.all([
      fetchInvoiceHistory({ branchId }),
      fetchInventoryReferenceData(branchId),
    ]);
    setInvoices(invoiceRows);
    setReference(referenceData);
    setSelectedId((current) => current || invoiceRows[0]?.id || null);
  }, [branchId, session]);

  const refreshSelected = useCallback(async () => {
    if (!selectedId || !session) {
      setSelected(null);
      return;
    }
    await reconcileInvoiceExceptions(selectedId);
    setSelected(await retrieveOcrResult(selectedId));
  }, [selectedId, session]);

  useEffect(() => {
    if (!session) return;
    setError("");
    refreshList().catch((err) => setError(err.message));
  }, [refreshList, session]);

  useEffect(() => {
    refreshSelected().catch((err) => setError(err.message));
  }, [refreshSelected]);

  useEffect(() => {
    setPostPhase("idle");
    setPostMessage("");
    setPostedReceipt(null);
    postLockRef.current?.release();
  }, [selectedId]);

  const rememberPosted = (invoice, result) => {
    const lines = (invoice?.inventory_invoice_lines || []).filter((line) => line.active !== false);
    setPostedReceipt({
      supplier: invoice?.inventory_suppliers?.supplier_name || "Supplier",
      number: invoice?.invoice_number || invoice?.source_filename,
      total: invoice?.total,
      currency: invoice?.currency,
      lines: lines.length,
      channel: invoice?.purchase_channel || "supplier_credit",
      reason: invoice?.purchase_reason,
      location: resolveReceivingLocation({
        explicitLocationId: invoice?.receiving_location_id,
        locations: reference.locations,
        branchId: invoice?.branch_id,
      }).location?.name || "Receiving location",
      status: result?.status || "posted",
      treatment: invoice?.receiving_treatment,
    });
  };

  const applyPostOutcome = (outcome, invoice) => {
    const message = outcome.state === "rejected" ? humanizePostError(outcome.message) : outcome.message;
    setPostPhase(outcome.state);
    setPostMessage(message);
    if (outcome.state === "posted" && invoice) rememberPosted(invoice, { status: "posted" });
    if (outcome.state === "rejected") {
      setError(message);
      postLockRef.current.release();
    }
  };

  const confirmPostingStatus = async () => {
    if (!selected?.id) return;
    try {
      const invoiceAfter = await retrieveOcrResult(selected.id);
      setSelected(invoiceAfter);
      const outcome = classifyPostOutcome({ error: new Error("timeout"), invoiceAfter });
      applyPostOutcome(outcome, invoiceAfter);
    } catch {
      setPostPhase("uncertain");
      setPostMessage("Posting status could not be confirmed. Refresh status before trying again.");
    }
  };

  const approveAndPost = async () => {
    if (!selected?.id) return;
    if (postPhase === "posting" || postPhase === "posted" || postPhase === "uncertain") return;
    if (!postLockRef.current.tryAcquire()) return;
    setPostPhase("posting");
    setPostMessage("Posting receipt…");
    setBusy("approve");
    setError("");
    let result = null;
    let error = null;
    try {
      result = await approveInvoice(selected.id);
    } catch (err) {
      error = err;
    }
    let invoiceAfter;
    if (error && isAmbiguousPostError(error)) {
      try {
        invoiceAfter = await retrieveOcrResult(selected.id);
        setSelected(invoiceAfter);
      } catch {
        invoiceAfter = null;
      }
    }
    const outcome = classifyPostOutcome({
      error,
      result,
      invoiceAfter: error && isAmbiguousPostError(error) ? invoiceAfter : undefined,
    });
    if (outcome.state === "posted") {
      setPostPhase("posted");
      setPostMessage(outcome.message);
      rememberPosted(invoiceAfter || selected, result);
      try {
        await refreshList();
        await refreshSelected();
      } catch {
        setPostMessage("Posted. This document already has one receipt. Reopen it if the ledger has not refreshed.");
      }
    } else {
      applyPostOutcome(outcome, invoiceAfter);
    }
    setBusy("");
  };

  const run = async (label, operation, successMessage) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      if (successMessage) setNotice(successMessage);
      await refreshList();
      await refreshSelected();
      return result;
    } catch (err) {
      setError(err.message || String(err));
      return null;
    } finally {
      setBusy("");
    }
  };

  const addPages = (fileList) => {
    const grouped = groupInvoicePages([...pages, ...Array.from(fileList || [])]);
    if (!grouped.ok) {
      setError(grouped.reason);
      return;
    }
    setError("");
    setPages(grouped.pages.map((page) => page.file));
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!pages.length || busy) return;
    setBusy("upload");
    setError("");
    setNotice("");
    setUploadFailed(false);
    let savedInvoice = null;
    let stage = "preparing";
    const markStage = (next) => {
      stage = next;
      setUploadStage(next);
    };
    try {
      markStage("preparing");
      const file = await buildInvoiceDocument(pages);
      const uploaded = await uploadInvoice({
        branchId,
        file,
        supplierId: uploadSupplierId || null,
        currency: "SAR",
        notes: pages.length > 1 ? `${pages.length} photos combined into one invoice.` : null,
        onStage: markStage,
      });
      savedInvoice = uploaded.invoice;
      setSelectedId(uploaded.invoice.id);
      const extract = invoiceNeedsExtraction(uploaded.invoice);
      if (extract) {
        markStage("extracting");
        try {
          await triggerInvoiceOcr(uploaded.invoice.id);
        } catch (error) {
          throw invoiceCaptureError("extract", error);
        }
      }
      markStage("review");
      await refreshList();
      await refreshSelected();
      setNotice(extract
        ? "Invoice uploaded and sent for extraction."
        : "This photo is already in the review queue.");
      setPages([]);
    } catch (err) {
      console.error("[invoice-capture]", err.stage || stage, err.cause || err);
      setError(err.stage ? err.message : invoiceCaptureFailureMessage(savedInvoice ? "extract" : "prepare", err));
      setUploadFailed(true);
      if (savedInvoice) {
        try {
          await refreshList();
          await refreshSelected();
        } catch (refreshError) {
          console.error("[invoice-capture] review refresh", refreshError);
        }
      }
    } finally {
      setBusy("");
      setUploadStage("");
    }
  };

  const handleHeaderSave = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await run("header", () => updateInvoiceReview(selected.id, {
      supplierId: values.get("supplierId"),
      invoiceNumber: values.get("invoiceNumber"),
      invoiceDate: values.get("invoiceDate"),
      effectiveReceiptDate: values.get("effectiveReceiptDate"),
      purchaseOrderReference: values.get("purchaseOrderReference"),
      subtotal: values.get("subtotal"),
      discount: values.get("discount"),
      tax: values.get("tax"),
      total: values.get("total"),
      reason: "invoice_intake_review",
      purchaseChannel: values.get("purchaseChannel") || "supplier_credit",
      purchaseReason: values.get("purchaseReason") || "",
      receivingLocationId: values.get("receivingLocationId") || "",
    }), "Invoice header saved.");
  };

  const handleMapLine = async (event, line) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const ingredientId = values.get("ingredientId");
    const ingredient = reference.ingredients.find(({ id }) => id === ingredientId);
    if (!ingredient) {
      setError("Select a canonical ingredient.");
      return;
    }
    await run(`line:${line.id}`, () => confirmLineMapping({
      invoiceLineId: line.id,
      ingredientId,
      catalogueItemId: values.get("catalogueItemId") || null,
      conversionFactor: values.get("conversionFactor"),
      canonicalQuantity: values.get("canonicalQuantity"),
      canonicalUnit: ingredient.base_inventory_unit,
      createVerifiedAlias: Boolean(values.get("learnAlias")),
      reason: "invoice_intake_manual_mapping",
    }), "Line mapping verified and saved.");
  };

  const handleCreateItem = async (event, line) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const family = values.get("family");
    const name = String(values.get("name") || "").trim();
    const unit = values.get("baseUnit");
    const received = values.get("receivedQuantity");
    if (!family || !name || !unit || !received) {
      setError("Name, family, unit, and received quantity are required before a new item is created.");
      return;
    }
    await run(`create:${line.id}`, async () => {
      const created = await createIngredient({
        canonicalName: name,
        category: values.get("category") || null,
        baseInventoryUnit: unit,
      });
      const coded = await assignHumanCode(created.id, family);
      await confirmLineMapping({
        invoiceLineId: line.id,
        ingredientId: coded.id,
        conversionFactor: values.get("conversionFactor") || "1",
        canonicalQuantity: received,
        canonicalUnit: unit,
        createVerifiedAlias: false,
        reason: "created_from_invoice_line",
      });
      return coded;
    }, "New item coded and mapped. This invoice stayed open.");
  };

  const handleReceived = async (event, line) => {
    event.preventDefault();
    const received = new FormData(event.currentTarget).get("receivedQuantity");
    await run(
      `received:${line.id}`,
      () => updateReceivedQuantity(selected.id, line.id, received),
      "Received quantity saved. The stock movement uses this quantity."
    );
  };

  const openSource = async () => {
    await run("source", async () => {
      const url = await getInvoiceSourceUrl(selected);
      window.open(url, "_blank", "noopener,noreferrer");
    });
  };

  const unresolved = useMemo(
    () => selected?.inventory_invoice_lines?.filter(
      (line) => line.active && !["verified", "auto_matched"].includes(line.review_status)
    ).length || 0,
    [selected]
  );
  const blocking = useMemo(
    () => selected?.inventory_invoice_exceptions?.filter(
      (item) => item.status === "open" && item.severity === "blocking"
    ).length || 0,
    [selected]
  );
  const operationalLocations = useMemo(
    () => (reference.locations || []).filter(isOperationalReceivingLocation),
    [reference.locations]
  );
  const locationResolution = useMemo(() => {
    if (!selected) return { location: null, source: "missing", requiresChoice: false };
    return resolveReceivingLocation({
      explicitLocationId: selected.receiving_location_id,
      locations: reference.locations,
      branchId: selected.branch_id || branchId,
    });
  }, [branchId, reference.locations, selected]);
  const inbox = useMemo(() => {
    if (!selected) return null;
    return triageInvoice({
      invoice: {
        ...selected,
        hasReceivingLocation: Boolean(locationResolution.location),
      },
      lines: selected.inventory_invoice_lines || [],
      ingredients: reference.ingredients,
      existingInvoices: invoices
        .filter((row) => row.id !== selected.id)
        .map((row) => ({
          id: row.id,
          fileHash: row.file_hash,
          supplierId: row.supplier_id,
          invoiceNumber: row.invoice_number,
          invoiceDate: row.invoice_date,
          total: row.total,
          status: row.status,
        })),
    });
  }, [invoices, locationResolution.location, reference.ingredients, selected]);

  if (!embedded && (!checked || !session)) {
    return (
      <NacAnalyticsSignIn
        checking={!checked}
        kicker="NAC Inventory"
        title="Invoice intake"
        subtitle="Authorized purchasing, inventory, and operations team members"
        sessionIssue={issue}
      />
    );
  }

  const workspace = (
    <>
      {(error || notice) && (
        <div className={`inv-banner ${error ? "inv-banner--error" : "inv-banner--success"}`}>
          {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
          <button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss">
            <XCircle size={16} />
          </button>
        </div>
      )}

      <section className="inv-upload-card">
        <div>
          <span className="inv-step">1</span>
          <div>
            <h2>Upload supplier invoice</h2>
            <p>PDF, JPEG, PNG, or WebP. The original remains protected and linked to the receipt.</p>
          </div>
        </div>
        <form onSubmit={handleUpload}>
          <select value={uploadSupplierId} onChange={(event) => setUploadSupplierId(event.target.value)}>
            <option value="">Identify supplier from invoice</option>
            {reference.suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}</option>
            ))}
          </select>
          <div className="inv-capture">
            <label className="inv-file">
              <ScanLine size={18} />
              <span>Take photo</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(event) => {
                  addPages(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            <label className="inv-file">
              <Upload size={18} />
              <span>{pages.length ? `${pages.length} page${pages.length === 1 ? "" : "s"}` : "Choose photo or PDF"}</span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => {
                  addPages(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {!!pages.length && (
            <ol className="inv-pages">
              {pages.map((page, index) => (
                <li key={`${page.name}-${index}`}>
                  Page {index + 1}: {page.name}
                  <button type="button" onClick={() => setPages(pages.filter((_, item) => item !== index))}>Remove</button>
                </li>
              ))}
            </ol>
          )}
          <button className="inv-button inv-button--primary" disabled={!pages.length || busy === "upload"}>
            {busy === "upload" ? <Loader2 className="inv-spin" size={17} /> : <ScanLine size={17} />}
            {busy === "upload" ? uploadStageLabel(uploadStage) : (uploadFailed ? "Retry" : "Upload & extract")}
          </button>
        </form>
      </section>

      <div className="inv-workspace">
        <aside className="inv-queue">
          <div className="inv-section-title">
            <div>
              <span className="inv-step">2</span>
              <h2>Review queue</h2>
            </div>
            <button onClick={() => run("refresh", refreshList)} aria-label="Refresh invoices">
              <RefreshCw className={busy === "refresh" ? "inv-spin" : ""} size={17} />
            </button>
          </div>
          {!invoices.length && <p className="inv-empty">No invoices are available for this branch.</p>}
          {invoices.map((invoice) => (
            <button
              key={invoice.id}
              className={`inv-queue-item ${selectedId === invoice.id ? "is-active" : ""}`}
              onClick={() => setSelectedId(invoice.id)}
            >
              <FileText size={18} />
              <span>
                <strong>{invoice.invoice_number || invoice.source_filename}</strong>
                <small>{invoice.inventory_suppliers?.supplier_name || "Supplier pending"}</small>
              </span>
              <em className={`inv-status inv-status--${statusTone(invoice.status)}`}>
                {invoice.status.replaceAll("_", " ")}
              </em>
            </button>
          ))}
        </aside>

        <section className="inv-review">
          {!selected && <div className="inv-empty inv-empty--large">Select an invoice to review.</div>}
          {selected && (
            <>
              <div className="inv-review-heading">
                <div>
                  <p className="inv-kicker">Invoice review</p>
                  <h2>{selected.invoice_number || selected.source_filename}</h2>
                  <div className="inv-inline-meta">
                    <span className={`inv-status inv-status--${statusTone(selected.status)}`}>
                      {selected.status.replaceAll("_", " ")}
                    </span>
                    <span>OCR {confidence(selected.ocr_confidence)}</span>
                    <span>{selected.ocr_provider || "OCR pending"}</span>
                  </div>
                </div>
                <button className="inv-button inv-button--ghost" onClick={openSource}>
                  <ExternalLink size={16} /> Original invoice
                </button>
              </div>

              {postedReceipt && (
                <section className="inv-inbox inv-inbox--ready" data-testid="receipt-posted">
                  <strong>POSTED</strong>
                  <p>{postedReceipt.supplier} · {postedReceipt.number}</p>
                  <p>{postedReceipt.lines} items · {money(postedReceipt.total, postedReceipt.currency)}</p>
                  <p>{postedReceipt.location}</p>
                  <p>Inventory updated. Repeated approval does not post a second receipt.</p>
                  {postedReceipt.treatment === "company_settled_document" && (
                    <p>Quantities were received without a supplier price. No cost benchmark was written.</p>
                  )}
                  {postedReceipt.channel === "cash_market" && (
                    <p>Cash / local market{postedReceipt.reason ? ` · ${postedReceipt.reason.replaceAll("_", " ")}` : ""}. This price is not the regular supplier benchmark.</p>
                  )}
                </section>
              )}

              {inbox && (
                <p className={`inv-inbox inv-inbox--${inbox.tone}`} data-testid="inventory-inbox">
                  <strong>{inbox.readiness?.headline || inbox.headline}</strong>
                  {" "}
                  {inbox.readiness?.summary || `${inbox.recognized}/${inbox.total} lines recognized. ${inbox.label}`}
                  {inbox.priceNote ? ` ${inbox.priceNote}` : ""}
                </p>
              )}

              <section className="inv-inbox" data-testid="receiving-card">
                <strong>{reference.suppliers.find((row) => row.id === selected.supplier_id)?.supplier_name || "Confirm supplier"}</strong>
                <p>#{selected.invoice_number || "—"} · {selected.invoice_date || "date pending"}</p>
                <p>{classifyDocumentKind(`${selected.raw_ocr_text || ""} ${selected.notes || ""}`) === "delivery_note"
                  ? "Delivery note. This can still be restaurant receiving evidence."
                  : "Receiving document."}</p>
                {locationResolution.location && (
                  <p data-testid="receiving-location">
                    Receiving at {locationResolution.location.name}
                    {locationResolution.source === "explicit" ? "" : " · automatic"}
                  </p>
                )}
                {(selected.inventory_invoice_lines || []).filter((line) => line.active !== false).map((line) => {
                  const price = resolvePriceRequirement({
                    treatment: selected.receiving_treatment,
                    channel: selected.purchase_channel || "supplier_credit",
                    line,
                  });
                  const suggestion = suggestCodeFamily(line.original_description);
                  return (
                    <p key={`card-${line.id}`}>
                      {line.original_description}
                      {" · "}
                      {line.original_quantity ?? "—"} {line.original_unit || ""}
                      {line.supplier_sku ? ` · SKU ${line.supplier_sku}` : ""}
                      {price.basis === "company_settled_price_not_required" ? " · No price required" : ""}
                      {price.basis === "price_missing_but_required" ? " · Price required" : ""}
                      {!line.ingredient_id && suggestion.family ? ` · Suggested ${suggestion.label} (${suggestion.family}), not allocated` : ""}
                    </p>
                  );
                })}
              </section>
              <InvoiceOnboarding
                invoice={selected}
                ingredients={reference.ingredients}
                profileConfirmed={Boolean(selected.receiving_treatment)}
                onChanged={async () => {
                  await refreshList();
                  await refreshSelected();
                }}
                run={run}
              />

              <div className="inv-summary">
                <article>
                  <strong>{selected.inventory_invoice_lines?.length || 0}</strong>
                  <span>extracted lines</span>
                </article>
                <article className={unresolved ? "is-warning" : ""}>
                  <strong>{unresolved}</strong>
                  <span>unresolved lines</span>
                </article>
                <article className={blocking ? "is-danger" : ""}>
                  <strong>{blocking}</strong>
                  <span>blocking exceptions</span>
                </article>
                <article>
                  <strong>{money(selected.total, selected.currency)}</strong>
                  <span>invoice total</span>
                </article>
              </div>

              <form key={selected.id} className="inv-header-form" onSubmit={handleHeaderSave}>
                <h3>Extracted header</h3>
                <label>Supplier
                  <select name="supplierId" defaultValue={selected.supplier_id || ""} required>
                    <option value="">Select supplier</option>
                    {reference.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}</option>
                    ))}
                  </select>
                </label>
                <label>Invoice number<input name="invoiceNumber" defaultValue={selected.invoice_number || ""} required /></label>
                <label>Invoice date<input type="date" name="invoiceDate" defaultValue={selected.invoice_date || ""} required /></label>
                <label>Effective receipt date<input type="date" name="effectiveReceiptDate" defaultValue={selected.effective_receipt_date || selected.invoice_date || ""} required /></label>
                <label>Purchase order<input name="purchaseOrderReference" defaultValue={selected.purchase_order_reference || ""} /></label>
                <label>Channel
                  <select name="purchaseChannel" defaultValue={selected.purchase_channel || "supplier_credit"}>
                    <option value="supplier_credit">Supplier credit</option>
                    <option value="cash_market">Cash / local market</option>
                  </select>
                </label>
                <label>Cash reason
                  <select name="purchaseReason" defaultValue={selected.purchase_reason || ""}>
                    <option value="">Normal order</option>
                    <option value="supplier_shortage">Supplier shortage</option>
                    <option value="supplier_unavailable">Supplier unavailable</option>
                    <option value="urgent_requirement">Urgent requirement</option>
                    <option value="quality_rejection">Quality rejection</option>
                    <option value="price_opportunity">Price opportunity</option>
                    <option value="emergency_purchase">Emergency purchase</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>Subtotal<input type="number" step="0.000001" name="subtotal" defaultValue={selected.subtotal ?? ""} required /></label>
                <label>Discount<input type="number" step="0.000001" name="discount" defaultValue={selected.discount ?? "0"} required /></label>
                <label>Tax<input type="number" step="0.000001" name="tax" defaultValue={selected.tax ?? "0"} required /></label>
                <label>Total<input type="number" step="0.000001" name="total" defaultValue={selected.total ?? ""} required /></label>
                <button className="inv-button inv-button--secondary" disabled={FINAL_STATUSES.has(selected.status) || busy === "header"}>
                  Save header
                </button>
              </form>

              {!!selected.inventory_invoice_exceptions?.length && (
                <section className="inv-exceptions">
                  <h3>Exceptions</h3>
                  {selected.inventory_invoice_exceptions.map((item) => (
                    <div key={item.id} className={`inv-exception inv-exception--${item.severity}`}>
                      <AlertTriangle size={16} />
                      <span><strong>{item.exception_type.replaceAll("_", " ")}</strong>{item.message}</span>
                      <em>{item.status}</em>
                      {item.status === "open" && !FINAL_STATUSES.has(selected.status) && (
                        <button
                          className="inv-button inv-button--ghost"
                          onClick={() => {
                            const reason = window.prompt("Resolution or acknowledgment reason:");
                            if (reason) {
                              run(
                                `exception:${item.id}`,
                                () => resolveInvoiceException(item.id, reason),
                                "Exception resolved with an audit record."
                              );
                            }
                          }}
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}

              <section className="inv-lines">
                <h3>Invoice lines</h3>
                {selected.inventory_invoice_lines?.map((line) => (
                  <article key={line.id} className="inv-line">
                    <div className="inv-line-source">
                      <span>Original supplier wording</span>
                      <strong>{line.original_description}</strong>
                      <small>SKU {line.supplier_sku || "—"} · OCR {confidence(line.ocr_confidence)}</small>
                    </div>
                    <div className="inv-line-numbers">
                      <span>Invoiced {line.original_quantity ?? "—"} {line.original_unit || "unit pending"}</span>
                      <span>Received {line.canonical_received_quantity ?? "—"} {line.canonical_unit || ""}</span>
                      <span>Pack {line.pack_quantity ?? "?"} × {line.pack_size ?? "?"} {line.pack_unit || ""}</span>
                      <span>{line.unit_price == null && line.line_total == null ? "Price absent" : money(line.line_total, selected.currency)}</span>
                    </div>
                    <div className="inv-line-match">
                      <span className={`inv-status inv-status--${lineReviewState(line).tone === "recognized" ? "success" : "warning"}`}>
                        {lineReviewState(line).label}
                      </span>
                      <strong>
                        {ingredientLabel(reference.ingredients.find(({ id }) => id === line.ingredient_id))}
                      </strong>
                      <small>
                        {line.canonical_received_quantity ?? "—"} {line.canonical_unit || ""} · {line.match_method?.replaceAll("_", " ") || "unmatched"}
                      </small>
                    </div>
                    {!FINAL_STATUSES.has(selected.status) && !["verified", "auto_matched"].includes(line.review_status) && (
                      <form className="inv-map-form" onSubmit={(event) => handleMapLine(event, line)}>
                        <select name="ingredientId" required>
                          <option value="">Choose canonical ingredient</option>
                          {reference.ingredients.map((ingredient) => (
                            <option key={ingredient.id} value={ingredient.id}>
                              {ingredientLabel(ingredient)} ({ingredient.base_inventory_unit})
                            </option>
                          ))}
                        </select>
                        <input name="catalogueItemId" placeholder="Catalogue item ID (optional)" />
                        <input name="conversionFactor" type="number" step="0.0000000001" min="0" placeholder="Conversion factor" required />
                        <input name="canonicalQuantity" type="number" step="0.0000000001" min="0" placeholder="Canonical quantity" required />
                        <label className="inv-check"><input type="checkbox" name="learnAlias" defaultChecked /> Learn verified alias</label>
                        <button
                          type="button"
                          className="inv-button inv-button--ghost"
                          onClick={() => run(`candidates:${line.id}`, () => generateMatchCandidates(line.id), "Candidates refreshed.")}
                        >
                          Suggest
                        </button>
                        <button className="inv-button inv-button--secondary" disabled={busy === `line:${line.id}`}>Verify line</button>
                      </form>
                    )}
                    {!FINAL_STATUSES.has(selected.status) && line.supplier_sku && line.pack_status !== "verified" && (
                      <button
                        type="button"
                        className="inv-button inv-button--ghost"
                        disabled={busy === `pack:${line.id}`}
                        onClick={() => run(`pack:${line.id}`, () => confirmLinePack(selected.id, line.id), "Pack conversion verified for this supplier SKU. Stock is still not posted.")}
                      >
                        Confirm pack conversion
                      </button>
                    )}
                    {!FINAL_STATUSES.has(selected.status) && (
                      <form className="inv-map-form" onSubmit={(event) => handleReceived(event, line)}>
                        <label>Received quantity
                          <input
                            name="receivedQuantity"
                            type="number"
                            step="0.0000000001"
                            min="0"
                            required
                            defaultValue={line.canonical_received_quantity ?? line.original_quantity ?? ""}
                          />
                        </label>
                        <button className="inv-button inv-button--ghost" disabled={busy === `received:${line.id}`}>
                          Save received quantity
                        </button>
                      </form>
                    )}
                    {!FINAL_STATUSES.has(selected.status) && !line.ingredient_id && (
                      <form className="inv-map-form" onSubmit={(event) => handleCreateItem(event, line)}>
                        <strong>Create new item</strong>
                        <input name="name" required placeholder="Canonical name" defaultValue="" />
                        <select name="family" required defaultValue="">
                          <option value="">Choose code family</option>
                          {CODE_FAMILIES.map(([code, label]) => (
                            <option key={code} value={code}>{label} ({code})</option>
                          ))}
                        </select>
                        <input name="category" placeholder="Category label, optional" />
                        <select name="baseUnit" required defaultValue="">
                          <option value="">Base unit</option>
                          {CANONICAL_UNITS.map((unit) => (
                            <option key={unit.value} value={unit.value}>{unit.label}</option>
                          ))}
                        </select>
                        <input
                          name="receivedQuantity"
                          type="number"
                          step="0.0000000001"
                          min="0"
                          required
                          placeholder="Received quantity"
                          defaultValue={line.canonical_received_quantity ?? line.original_quantity ?? ""}
                        />
                        <input name="conversionFactor" type="number" step="0.0000000001" min="0" defaultValue="1" />
                        <button className="inv-button inv-button--secondary" disabled={busy === `create:${line.id}`}>
                          Create, code, and map
                        </button>
                        <small>
                          {suggestCodeFamily(line.original_description).family
                            ? `Suggestion: ${suggestCodeFamily(line.original_description).label} (${suggestCodeFamily(line.original_description).family}). Confirm a family before a code is issued. This does not allocate a code.`
                            : "Choose a family. Food is not the default, and no code is allocated until you confirm."}
                        </small>
                      </form>
                    )}
                    {!!line.match_candidates?.length && (
                      <div className="inv-candidates">
                        {line.match_candidates.map((candidate, index) => (
                          <span key={`${candidate.ingredientId}-${index}`}>
                            #{index + 1} {confidence(candidate.confidence)} · {candidate.method?.replaceAll("_", " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </section>

              <footer className="inv-approval" aria-busy={postPhase === "posting"}>
                <div>
                  <span className="inv-step">3</span>
                  <div>
                    <h3>Approve and post</h3>
                    <p>Creates one receipt and the quantity movements for this document. A second click cannot create a second receipt.</p>
                  </div>
                </div>
                <div>
                  {postMessage && (
                    <p className={`inv-post-status inv-post-status--${postPhase}`} role="status" aria-live="assertive">
                      {postMessage}
                    </p>
                  )}
                  {postPhase === "uncertain" && (
                    <button type="button" className="inv-button inv-button--secondary" onClick={confirmPostingStatus}>
                      Refresh status
                    </button>
                  )}
                  {inbox?.readiness?.actions?.includes("Choose where this delivery was received.") && postPhase !== "posted" && (
                    operationalLocations.length ? (
                      <form onSubmit={(event) => {
                        event.preventDefault();
                        const receivingLocationId = new FormData(event.currentTarget).get("receivingLocationId");
                        if (!receivingLocationId) return;
                        run("location", () => updateInvoiceReview(selected.id, {
                          receivingLocationId,
                          reason: "Receiving location confirmed for this document.",
                        }), "Receiving location saved. Stock is still not posted.");
                      }}>
                        <label>Receiving location
                          <select name="receivingLocationId" required defaultValue="">
                            <option value="">Choose a receiving location</option>
                            {operationalLocations.map((location) => (
                              <option key={location.id} value={location.id}>{location.name}</option>
                            ))}
                          </select>
                        </label>
                        <button className="inv-button inv-button--secondary" disabled={busy === "location"}>
                          Save receiving location
                        </button>
                      </form>
                    ) : (
                      <p role="status">No receiving location is configured for this branch. Nothing has been posted.</p>
                    )
                  )}
                  <button
                    className="inv-button inv-button--danger"
                    disabled={FINAL_STATUSES.has(selected.status) || busy === "reject" || postPhase === "posting" || postPhase === "uncertain"}
                    onClick={() => {
                      const reason = window.prompt("Reason for rejecting this invoice:");
                      if (reason) run("reject", () => rejectInvoice(selected.id, reason), "Invoice rejected.");
                    }}
                  >
                    Reject
                  </button>
                  <button
                    className="inv-button inv-button--primary"
                    disabled={FINAL_STATUSES.has(selected.status) || unresolved > 0 || blocking > 0 || inbox?.mayPost === false || postPhase === "posting" || postPhase === "posted" || postPhase === "uncertain"}
                    onClick={approveAndPost}
                  >
                    {postPhase === "posting" ? <Loader2 className="inv-spin" size={17} /> : <CheckCircle2 size={17} />}
                    {postPhase === "posting" ? "Posting receipt…" : postPhase === "posted" ? "Posted" : "Approve & post"}
                  </button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
    </>
  );

  if (embedded) {
    return workspace;
  }

  return (
    <main className="inv-page">
      <header className="inv-header">
        <div>
          <p className="inv-kicker">NAC Hospitality OS</p>
          <h1>Inventory & Invoice Intelligence</h1>
          <p>Upload the supplier invoice, review exceptions, then post stock and cost once.</p>
        </div>
        <div className="inv-header-actions">
          <label>
            <span>Branch</span>
            <select value={branchId} onChange={(event) => {
              setBranchId(event.target.value);
              setSelectedId(null);
            }}>
              {BRANCHES.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.label}</option>
              ))}
            </select>
          </label>
          <button className="inv-button inv-button--ghost" onClick={() => supabase?.auth.signOut()}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>
      {workspace}
    </main>
  );
}
