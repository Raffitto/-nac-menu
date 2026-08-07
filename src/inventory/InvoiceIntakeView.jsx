import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  fetchInventoryReferenceData,
  fetchInvoiceHistory,
  fetchPurchaseOrders,
  generateMatchCandidates,
  getInvoiceSourceUrl,
  rejectInvoice,
  linkInvoicePurchaseOrder,
  resolveInvoiceException,
  retrieveOcrResult,
  triggerInvoiceOcr,
  updateInvoiceReview,
  uploadInvoice,
} from "../lib/inventoryApi";
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
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState(null);
  const [uploadSupplierId, setUploadSupplierId] = useState("");

  const refreshList = useCallback(async () => {
    if (!session) return;
    const [invoiceRows, referenceData, purchaseOrderRows] = await Promise.all([
      fetchInvoiceHistory({ branchId }),
      fetchInventoryReferenceData(branchId),
      fetchPurchaseOrders({ branchId }),
    ]);
    setInvoices(invoiceRows);
    setReference(referenceData);
    setPurchaseOrders(purchaseOrderRows);
    setSelectedId((current) => current || invoiceRows[0]?.id || null);
  }, [branchId, session]);

  const refreshSelected = useCallback(async () => {
    if (!selectedId || !session) {
      setSelected(null);
      return;
    }
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

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file) return;
    const result = await run("upload", async () => {
      const uploaded = await uploadInvoice({
        branchId,
        file,
        supplierId: uploadSupplierId || null,
        currency: "SAR",
      });
      setSelectedId(uploaded.invoice.id);
      if (!uploaded.duplicate) await triggerInvoiceOcr(uploaded.invoice.id);
      return uploaded;
    }, "Invoice uploaded and sent for extraction.");
    if (result) setFile(null);
  };

  const handleHeaderSave = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await run("header", async () => {
      await updateInvoiceReview(selected.id, {
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
      });
      return linkInvoicePurchaseOrder({
        invoiceId: selected.id,
        purchaseOrderId: values.get("purchaseOrderId") || null,
        additionalCost: values.get("additionalCost") || 0,
      });
    }, "Invoice header and purchase-order link saved.");
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
          <label className="inv-file">
            <Upload size={18} />
            <span>{file?.name || "Choose invoice"}</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <button className="inv-button inv-button--primary" disabled={!file || busy === "upload"}>
            {busy === "upload" ? <Loader2 className="inv-spin" size={17} /> : <ScanLine size={17} />}
            Upload & extract
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
                <label>Approved purchase order
                  <select name="purchaseOrderId" defaultValue={selected.purchase_order_id || ""}>
                    <option value="">No linked PO</option>
                    {purchaseOrders
                      .filter(({ supplier_id, status }) => supplier_id === selected.supplier_id && ["approved", "partially_received", "received"].includes(status))
                      .map((order) => <option key={order.id} value={order.id}>{order.reference_number}</option>)}
                  </select>
                </label>
                <label>Purchase order reference<input name="purchaseOrderReference" defaultValue={selected.purchase_order_reference || ""} /></label>
                <label>Subtotal<input type="number" step="0.000001" name="subtotal" defaultValue={selected.subtotal ?? ""} required /></label>
                <label>Discount<input type="number" step="0.000001" name="discount" defaultValue={selected.discount ?? "0"} required /></label>
                <label>Tax<input type="number" step="0.000001" name="tax" defaultValue={selected.tax ?? "0"} required /></label>
                <label>Additional cost<input type="number" min="0" step="0.000001" name="additionalCost" defaultValue={selected.additional_cost ?? "0"} required /></label>
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
                      <span>{line.original_quantity ?? "—"} {line.original_unit || "unit pending"}</span>
                      <span>Pack {line.pack_quantity ?? "?"} × {line.pack_size ?? "?"} {line.pack_unit || ""}</span>
                      <span>{money(line.line_total, selected.currency)}</span>
                    </div>
                    <div className="inv-line-match">
                      <span className={`inv-status inv-status--${line.review_status === "needs_review" ? "warning" : "success"}`}>
                        {line.review_status.replaceAll("_", " ")}
                      </span>
                      <strong>
                        {reference.ingredients.find(({ id }) => id === line.ingredient_id)?.canonical_name || "Canonical ingredient required"}
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
                              {ingredient.canonical_name} ({ingredient.base_inventory_unit})
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

              <footer className="inv-approval">
                <div>
                  <span className="inv-step">3</span>
                  <div>
                    <h3>Approve and post</h3>
                    <p>Creates one receipt, immutable movements, cost history, and recipe/menu cost snapshots atomically.</p>
                  </div>
                </div>
                <div>
                  <button
                    className="inv-button inv-button--danger"
                    disabled={FINAL_STATUSES.has(selected.status) || busy === "reject"}
                    onClick={() => {
                      const reason = window.prompt("Reason for rejecting this invoice:");
                      if (reason) run("reject", () => rejectInvoice(selected.id, reason), "Invoice rejected.");
                    }}
                  >
                    Reject
                  </button>
                  <button
                    className="inv-button inv-button--primary"
                    disabled={FINAL_STATUSES.has(selected.status) || unresolved > 0 || blocking > 0 || busy === "approve"}
                    onClick={() => run("approve", () => approveInvoice(selected.id), "Invoice posted. Repeated approval will return this receipt.")}
                  >
                    {busy === "approve" ? <Loader2 className="inv-spin" size={17} /> : <CheckCircle2 size={17} />}
                    Approve & post
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
