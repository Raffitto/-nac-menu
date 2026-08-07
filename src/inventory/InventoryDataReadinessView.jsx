import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  Search,
  ShoppingBasket,
  X,
} from "lucide-react";
import {
  createInventoryItemFromInvoiceCandidate,
  fetchInventoryDataReadiness,
  fetchInventoryStaffAccess,
  linkMenuItemRecipe,
  reviewSalesConsumptionBatch,
  setMenuItemCostingIntent,
} from "../lib/inventoryApi";
import {
  classifyCatalogueCandidate,
  COSTING_INTENTS,
  COVERAGE_FILTERS,
  COVERAGE_STATUS,
  filterCoverageProducts,
  prioritizeRecipeWork,
} from "./dataReadiness";

const VIEWS = [
  { id: "coverage", label: "Recipe coverage" },
  { id: "catalogue", label: "Catalogue onboarding" },
  { id: "sales", label: "Sales sources" },
];

function formatPct(value) {
  return value == null ? "Unavailable" : `${Number(value).toFixed(1)}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-SA", { maximumFractionDigits: 2 });
}

function statusLabel(status) {
  return String(status || "NEEDS_REVIEW").replaceAll("_", " ");
}

export default function InventoryDataReadinessView({
  branchId,
  onOpenFoodBible = () => {},
  onOpenIngredients = () => {},
}) {
  const [data, setData] = useState(null);
  const [access, setAccess] = useState(null);
  const [view, setView] = useState("coverage");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState(COVERAGE_STATUS.ALL);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [candidate, setCandidate] = useState(null);

  const canApprove = ["ceo", "super_admin", "ops_manager", "branch_manager", "cost_controller"].includes(
    access?.vaultRole,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [readiness, staffAccess] = await Promise.all([
        fetchInventoryDataReadiness({ branchId, asOf }),
        fetchInventoryStaffAccess(),
      ]);
      setData(readiness);
      setAccess(staffAccess);
    } catch (err) {
      setError(err.message || "Could not load inventory data readiness.");
    } finally {
      setLoading(false);
    }
  }, [branchId, asOf]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const products = useMemo(
    () => filterCoverageProducts(data?.products || [], {
      status: statusFilter,
      search,
    }),
    [data?.products, statusFilter, search],
  );
  const priorities = useMemo(
    () => prioritizeRecipeWork(data?.products || []),
    [data?.products],
  );

  const run = async (key, action, success) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await refresh();
      return true;
    } catch (err) {
      setError(err.message || "The action could not be completed.");
      return false;
    } finally {
      setBusy("");
    }
  };

  const confirmIntent = async (product, costingIntent) => {
    const reason = window.prompt(
      `Confirm "${statusLabel(costingIntent)}" for ${product.name}.\nReason:`,
      "Reviewed for recipe coverage",
    );
    if (!reason?.trim()) return;
    await run(
      `intent:${product.menuItemId}`,
      () => setMenuItemCostingIntent({
        branchId,
        menuItemId: product.menuItemId,
        costingIntent,
        reason,
        evidence: {
          previousSuggestion: product.suggestedIntent,
          suggestionConfidence: product.suggestionConfidence,
        },
      }),
      "Costing intent confirmed with an audit trail.",
    );
  };

  const reviewBatch = async (source, status) => {
    const action = status === "approved" ? "approve" : "reject";
    const reason = window.prompt(
      `${action === "approve" ? "Approve" : "Reject"} ${source.source_file_name || "sales source"}.\nReason:`,
      action === "approve"
        ? "Reviewed as net-of-void/refund product aggregate"
        : "Not suitable for inventory consumption",
    );
    if (!reason?.trim()) return;
    await run(
      `batch:${source.batch_id}`,
      () => reviewSalesConsumptionBatch({
        batchId: source.batch_id,
        status,
        quantitySemantics: status === "approved"
          ? "net_of_voids_refunds"
          : "unknown",
        reason,
        sourceMetadata: {
          confirmedByUser: true,
          originalImportType: source.import_type,
          hasOverlappingSource: source.has_overlapping_source,
        },
      }),
      `Sales source ${status}.`,
    );
  };

  const linkRecipe = async (product, recipeId) => {
    if (!recipeId) return;
    const recipe = (data?.availableRecipes || []).find(
      (entry) => entry.recipeId === recipeId,
    );
    const reason = window.prompt(
      `Link ${product.name} to ${recipe?.name || "the selected recipe"}.\nReason:`,
      "Reviewed and confirmed recipe linkage",
    );
    if (!reason?.trim()) return;
    await run(
      `recipe:${product.menuItemId}`,
      () => linkMenuItemRecipe({
        branchId,
        menuItemId: product.menuItemId,
        recipeId,
        reason,
      }),
      "Menu item linked to the canonical recipe.",
    );
  };

  const createCandidate = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const succeeded = await run(
      `candidate:${candidate.invoice_line_id}`,
      () => createInventoryItemFromInvoiceCandidate({
        invoiceLineId: candidate.invoice_line_id,
        reason: values.get("reason"),
        payload: {
          canonicalName: values.get("canonicalName"),
          baseUnit: values.get("baseUnit"),
          classification: values.get("classification"),
          recipeCostEligible: values.get("recipeCostEligible") === "on",
          conversionFactor: values.get("conversionFactor"),
          packQuantity: candidate.pack_quantity || 1,
          packSize: candidate.pack_size || 1,
          packUnit: values.get("baseUnit"),
          sourceCategory: null,
        },
      }),
      "Canonical item created and source mapping preserved.",
    );
    if (succeeded) setCandidate(null);
  };

  const productCoverage = data?.productCoverage || {};
  const ingredientCoverage = data?.ingredientCoverage || {};
  const salesCoverage = data?.salesCoverage || {};

  return (
    <section className="inv-readiness" data-testid="inventory-data-readiness">
      {(error || notice) ? (
        <div className={`inv-banner ${error ? "inv-banner--error" : "inv-banner--success"}`}>
          {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => { setError(""); setNotice(""); }}>
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="inv-command-toolbar">
        <div className="inv-command-view-tabs" role="tablist" aria-label="Data readiness views">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`inv-tab${view === entry.id ? " inv-tab--active" : ""}`}
              onClick={() => setView(entry.id)}
              data-testid={`readiness-view-${entry.id}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <label className="inv-ingredients-filter">
          <span>As of</span>
          <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
        </label>
      </div>

      {loading ? (
        <div className="inv-ingredients-state">
          <Loader2 size={22} className="inv-spin" /> Loading real-data readiness…
        </div>
      ) : view === "coverage" ? (
        <>
          <div className="inv-fb-summary">
            <article><strong>{productCoverage.totalActiveProducts || 0}</strong><span>Active products</span></article>
            <article><strong>{productCoverage.mapped || 0}</strong><span>Recipe mapped</span></article>
            <article><strong>{productCoverage.trusted || 0}</strong><span>Trusted</span></article>
            <article><strong>{productCoverage.directStock || 0}</strong><span>Direct stock</span></article>
            <article><strong>{productCoverage.unresolved || 0}</strong><span>Unresolved intent</span></article>
          </div>
          <div className="inv-fb-summary">
            <article><strong>{ingredientCoverage.referencedIngredients || 0}</strong><span>Referenced ingredients</span></article>
            <article><strong>{ingredientCoverage.historicalCostAvailable || 0}</strong><span>With historical cost</span></article>
            <article><strong>{formatPct(salesCoverage.unitCoveragePct)}</strong><span>Sales-unit coverage</span></article>
            <article><strong>{formatPct(salesCoverage.salesValueCoveragePct)}</strong><span>Sales-value coverage</span></article>
            <article><strong>{salesCoverage.approvedBatchCount || 0}</strong><span>Approved sales sources</span></article>
          </div>

          <div className="inv-command-callout">
            <ShoppingBasket size={18} />
            <div>
              <strong>Deterministic work queue</strong>
              <p>
                {priorities.currentUnitCoveragePct == null
                  ? "Approve a non-overlapping sales source before sales-weighted prioritization is available."
                  : `Completing the top ${priorities.products.length} products would move unit coverage from ${formatPct(priorities.currentUnitCoveragePct)} to ${formatPct(priorities.projectedUnitCoveragePct)}.`}
              </p>
            </div>
          </div>

          <div className="inv-ingredients-toolbar">
            <div className="inv-ingredients-search">
              <Search size={16} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search products, sections, or recipes"
                aria-label="Search recipe coverage"
              />
            </div>
            <label className="inv-ingredients-filter">
              <span>Coverage state</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {COVERAGE_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>{filter.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="inv-button inv-button--secondary" onClick={() => onOpenFoodBible()}>
              Open Food Bible
            </button>
          </div>

          <div className="inv-ingredients-table-wrap">
            <table className="inv-ingredients-table inv-readiness-table">
              <thead>
                <tr>
                  <th>Product</th><th>Section</th><th>Coverage</th><th>Recipe</th>
                  <th>Cost trust</th><th>Sales</th><th>Costing intent</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.menuItemId}>
                    <td><strong>{product.name}</strong><small>{product.category}</small></td>
                    <td>{product.section || "—"}</td>
                    <td><span className="inv-status-pill">{statusLabel(product.coverageStatus)}</span></td>
                    <td>
                      {product.recipeName || "Not linked"}
                      {!product.recipeId ? (
                        <>
                          {(data?.availableRecipes || []).length ? (
                            <select
                              value=""
                              aria-label={`Link recipe for ${product.name}`}
                              disabled={!canApprove || busy === `recipe:${product.menuItemId}`}
                              onChange={(event) => linkRecipe(product, event.target.value)}
                            >
                              <option value="">Link existing…</option>
                              {data.availableRecipes.map((recipe) => (
                                <option key={recipe.recipeId} value={recipe.recipeId}>
                                  {recipe.name} · {statusLabel(recipe.recipeType)}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          <button
                            type="button"
                            className="inv-button inv-button--ghost"
                            onClick={() => onOpenFoodBible({
                              menuItemId: product.menuItemId,
                              recipeType: (
                                product.costingIntent || product.suggestedIntent
                              ) === "direct_stock" ? "direct_stock" : "menu_item",
                            })}
                          >
                            Document
                          </button>
                        </>
                      ) : null}
                    </td>
                    <td>{statusLabel(product.costTrustStatus || "UNAVAILABLE")}</td>
                    <td>{salesCoverage.approvedBatchCount
                      ? `${formatNumber(product.soldUnits)} units · SAR ${formatNumber(product.salesValue)}`
                      : "Awaiting approved source"}</td>
                    <td>
                      <select
                        value={product.costingIntent || product.suggestedIntent}
                        aria-label={`Costing intent for ${product.name}`}
                        disabled={!canApprove || busy === `intent:${product.menuItemId}`}
                        onChange={(event) => confirmIntent(product, event.target.value)}
                      >
                        {COSTING_INTENTS.map((intent) => (
                          <option key={intent.value} value={intent.value}>{intent.label}</option>
                        ))}
                      </select>
                      <small>
                        {product.costingIntent
                          ? "Confirmed"
                          : `${product.suggestionConfidence} confidence suggestion`}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : view === "catalogue" ? (
        <>
          <div className="inv-command-callout">
            <Database size={18} />
            <div>
              <strong>Source evidence remains immutable</strong>
              <p>Canonical creation preserves supplier description, SKU, quantity, unit, and invoice evidence. Duplicate candidates must be linked through review.</p>
            </div>
          </div>
          <div className="inv-ingredients-table-wrap">
            <table className="inv-ingredients-table">
              <thead>
                <tr><th>Supplier source</th><th>SKU</th><th>Source quantity</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {(data?.catalogueCandidates || []).map((row) => {
                  const classification = classifyCatalogueCandidate(row);
                  return (
                    <tr key={row.invoice_line_id}>
                      <td><strong>{row.original_description}</strong><small>{row.supplier_name || "Supplier unresolved"}</small></td>
                      <td>{row.supplier_sku || "—"}</td>
                      <td>{formatNumber(row.original_quantity)} {row.original_unit}</td>
                      <td><span className="inv-status-pill">{statusLabel(classification.status)}</span><small>{classification.reason}</small></td>
                      <td>
                        <button
                          type="button"
                          className="inv-button inv-button--secondary"
                          disabled={!canApprove || !classification.canCreate}
                          onClick={() => setCandidate(row)}
                        >
                          Create canonical
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!(data?.catalogueCandidates || []).length ? (
            <div className="inv-ingredients-state"><p>No unresolved supplier-source candidates.</p></div>
          ) : null}
          <button type="button" className="inv-button inv-button--ghost" onClick={onOpenIngredients}>
            Open Ingredient Master
          </button>
        </>
      ) : (
        <>
          <div className="inv-command-callout">
            <AlertTriangle size={18} />
            <div>
              <strong>Approval is required before consumption</strong>
              <p>Current uploads are period aggregates. Overlapping batches cannot both be approved, and void/refund semantics must be confirmed.</p>
            </div>
          </div>
          <div className="inv-ingredients-table-wrap">
            <table className="inv-ingredients-table">
              <thead>
                <tr><th>Period</th><th>Source</th><th>Rows</th><th>Units / sales</th><th>Quality</th><th>Review</th></tr>
              </thead>
              <tbody>
                {(data?.salesSources || []).map((source) => (
                  <tr key={source.batch_id}>
                    <td>{source.period_start} — {source.period_end}</td>
                    <td><strong>{source.source_file_name || "Manual import"}</strong><small>{source.import_type}</small></td>
                    <td>{source.row_count}</td>
                    <td>{formatNumber(source.sold_units)} · SAR {formatNumber(source.sales_value)}</td>
                    <td>
                      <span className="inv-status-pill">{source.dated_rows ? "DAILY" : "PERIOD ONLY"}</span>
                      {source.has_overlapping_source ? <small>Overlapping source exists</small> : null}
                      {source.unmatched_rows ? <small>{source.unmatched_rows} unmatched rows</small> : null}
                    </td>
                    <td>
                      <span className="inv-status-pill">{statusLabel(source.review_status)}</span>
                      {canApprove && source.review_status !== "approved" && Number(source.row_count) > 0 ? (
                        <div className="inv-inline-actions">
                          <button
                            type="button"
                            className="inv-button inv-button--secondary"
                            disabled={busy === `batch:${source.batch_id}`}
                            onClick={() => reviewBatch(source, "approved")}
                          >
                            Approve net source
                          </button>
                          <button
                            type="button"
                            className="inv-button inv-button--ghost"
                            disabled={busy === `batch:${source.batch_id}`}
                            onClick={() => reviewBatch(source, "rejected")}
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {candidate ? (
        <div className="inv-ingredients-panel-backdrop" role="presentation" onClick={() => setCandidate(null)}>
          <aside
            className="inv-ingredients-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Create canonical inventory item"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="inv-ingredients-panel-header">
              <div><p className="inv-kicker">Controlled onboarding</p><h2>Create canonical item</h2></div>
              <button type="button" className="inv-button inv-button--ghost" onClick={() => setCandidate(null)} aria-label="Close">
                <X size={16} />
              </button>
            </header>
            <form className="inv-fb-editor-form" onSubmit={createCandidate}>
              <div className="inv-fb-section-body inv-fb-grid">
                <label><span>Source description</span><input value={candidate.original_description} readOnly /></label>
                <label><span>Source unit</span><input value={candidate.original_unit || ""} readOnly /></label>
                <label><span>Canonical name</span><input name="canonicalName" defaultValue={candidate.original_description} required /></label>
                <label>
                  <span>Base unit</span>
                  <select name="baseUnit" required defaultValue="">
                    <option value="" disabled>Select after review</option>
                    {["each", "gram", "kilogram", "millilitre", "litre"].map((unit) => <option key={unit}>{unit}</option>)}
                  </select>
                </label>
                <label>
                  <span>Classification</span>
                  <select name="classification" defaultValue="other">
                    {["food_ingredient", "beverage", "packaging", "cleaning", "operating_supply", "chemical", "equipment_consumable", "other"].map((value) => (
                      <option key={value} value={value}>{statusLabel(value)}</option>
                    ))}
                  </select>
                </label>
                <label><span>Source-to-base conversion</span><input name="conversionFactor" type="number" min="0.0000000001" step="0.0000000001" required /></label>
                <label className="inv-check"><input name="recipeCostEligible" type="checkbox" /> Recipe-cost eligible</label>
                <label className="inv-fb-grid-full"><span>Approval reason</span><textarea name="reason" required /></label>
              </div>
              <footer className="inv-ingredients-panel-actions">
                <button type="button" className="inv-button inv-button--ghost" onClick={() => setCandidate(null)}>Cancel</button>
                <button className="inv-button inv-button--primary" disabled={busy === `candidate:${candidate.invoice_line_id}`}>
                  Create and link
                </button>
              </footer>
            </form>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
