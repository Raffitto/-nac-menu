import React, { useMemo, useState } from "react";
import { ACTIVATION_DECISION, PURCHASE_EVIDENCE_CLASS, RECIPE_VERSION_CLASS } from "./truth/readinessContracts";
import { fetchInventoryReadinessAudit } from "../lib/inventoryReadinessApi";
import { canViewInventoryTruthDiagnostics } from "../lib/inventoryTruthApi";

function pct(covered, total) {
  if (!total) return "Unavailable";
  return `${((Number(covered) / Number(total)) * 100).toFixed(2)}%`;
}

export default function InventoryReadinessPanel({
  branchId,
  periodStart,
  periodEnd,
  access = null,
  rbacProfile = null,
}) {
  const allowed = canViewInventoryTruthDiagnostics({ access, rbacProfile });
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recipeFilter, setRecipeFilter] = useState("SAFE_TO_ACTIVATE");
  const [costFilter, setCostFilter] = useState("all");

  const recipeRows = useMemo(() => {
    const rows = [...(audit?.recipes?.rows || [])]
      .sort((left, right) => Number(right.soldQuantity || 0) - Number(left.soldQuantity || 0));
    if (recipeFilter === "all") return rows;
    if (recipeFilter === "SAFE_TO_ACTIVATE") {
      return rows.filter((row) => row.decision === ACTIVATION_DECISION.SAFE_TO_ACTIVATE);
    }
    if (recipeFilter === "REVIEW_REQUIRED") {
      return rows.filter((row) => row.decision === ACTIVATION_DECISION.REVIEW_REQUIRED);
    }
    return rows.filter((row) => row.class === recipeFilter);
  }, [audit, recipeFilter]);

  const costRows = useMemo(() => {
    const rows = [...(audit?.costs?.rows || [])].sort((left, right) => (
      Number(right.theoreticalQuantity || 0) - Number(left.theoreticalQuantity || 0)
      || Number(right.recoverable) - Number(left.recoverable)
    ));
    if (costFilter === "all") return rows;
    return rows.filter((row) => row.class === costFilter);
  }, [audit, costFilter]);

  const runScan = async () => {
    setLoading(true);
    setError("");
    try {
      setAudit(await fetchInventoryReadinessAudit({
        branchId,
        periodStart,
        periodEnd,
        access,
        rbacProfile,
      }));
    } catch (err) {
      setError(err?.message || "Readiness scan unavailable");
      setAudit(null);
    } finally {
      setLoading(false);
    }
  };

  if (!allowed) return null;

  return (
    <section className="inv-readiness" data-testid="inventory-readiness-panel">
      <h3>Inventory readiness recovery</h3>
      <p className="inv-muted">
        Classify draft recipes, name-only commerce identities, and purchase evidence. This scan does not activate recipes or write costs.
      </p>
      <p className="inv-muted">
        Period {periodStart || "—"} – {periodEnd || "—"} · Branch {branchId || "network"} · Actual UNAVAILABLE · Variance not computable
      </p>
      <button type="button" className="inv-button" onClick={runScan} disabled={loading}>
        {loading ? "Scanning…" : "Scan inventory readiness"}
      </button>
      {error ? <p className="inv-error" role="alert">{error}</p> : null}
      {audit ? (
        <>
          <p className="inv-muted" data-testid="inventory-readiness-recipe-counts">
            Blocked recipes {audit.recipes.blocked}
            {" · "}Safe {audit.recipes.safeToActivate}
            {" · "}Review {audit.recipes.reviewRequired}
            {" · "}Broken {audit.recipes.broken}
            {" · "}Mapping missing {audit.recipes.mappingMissing}
            {" · "}True missing {audit.recipes.trueMissing}
            {" · "}Source confirmed {audit.recipes.sourceClassCounts?.SOURCE_CONFIRMED_CURRENT || 0}
            {" · "}Source diffs {audit.recipes.sourceClassCounts?.SOURCE_CONFIRMED_WITH_DIFFERENCES || 0}
            {" · "}No source {audit.recipes.sourceClassCounts?.NO_SOURCE_EVIDENCE || 0}
          </p>
          <p className="inv-muted" data-testid="inventory-readiness-sales-counts">
            Covered now {audit.sales.coveredToday}
            {" · "}If safe activated {audit.sales.coveredIfSafeActivated}
            {" · "}{pct(audit.sales.coveredIfSafeActivated, (audit.sales.coveredToday || 0) + (audit.sales.uncoveredToday || 0))}
            {" · "}Name-only {audit.sales.nameOnly}
            {" · "}Deterministic maps {audit.proposedIdentityRepairs.length}
            {" · "}Source {audit.salesSource || "unavailable"}
          </p>
          <p className="inv-muted" data-testid="inventory-readiness-cost-counts">
            Active ingredients {audit.costs.activeIngredients}
            {" · "}Any evidence {audit.costs.withAnyEvidence}
            {" · "}Complete {audit.costs.classCounts?.[PURCHASE_EVIDENCE_CLASS.PURCHASE_EVIDENCE_COMPLETE] || 0}
            {" · "}Unmapped invoice lines {audit.costs.unmappedInvoiceLines}
            {" · "}Recoverable {audit.costs.recoverable}
            {" · "}No source {audit.costs.classCounts?.[PURCHASE_EVIDENCE_CLASS.NO_PURCHASE_SOURCE] || 0}
          </p>
          <p className="inv-muted">{audit.lifecycle.gap}</p>

          <label>
            <span>Recipe filter</span>
            <select value={recipeFilter} onChange={(event) => setRecipeFilter(event.target.value)}>
              <option value="SAFE_TO_ACTIVATE">Safe to activate</option>
              <option value="REVIEW_REQUIRED">Review required</option>
              <option value={RECIPE_VERSION_CLASS.BROKEN_RECIPE}>Broken</option>
              <option value={RECIPE_VERSION_CLASS.MENU_MAPPING_MISSING}>Mapping missing</option>
              <option value={RECIPE_VERSION_CLASS.TRUE_RECIPE_MISSING}>True missing</option>
              <option value="all">All blocked</option>
            </select>
          </label>
          <ul className="inv-readiness-list" data-testid="inventory-readiness-recipe-list">
            {recipeRows.slice(0, 40).map((row) => (
              <li key={row.recipeId}>
                <strong>{row.soldDisplayName || row.recipeName}</strong>
                {" · "}sold {row.soldQuantity}
                {row.netSales != null ? ` · SAR ${row.netSales}` : ""}
                {" · "}{row.recipeName}
                {" · "}{row.candidate ? `v${row.candidate.versionNumber} ${row.candidate.status}` : "no version"}
                {" · "}{row.decision}
                {row.sourceClass ? ` · ${row.sourceClass}` : ""}
                {" · "}{row.reason}
              </li>
            ))}
          </ul>

          <label>
            <span>Cost filter</span>
            <select value={costFilter} onChange={(event) => setCostFilter(event.target.value)}>
              <option value="all">All active ingredients</option>
              <option value={PURCHASE_EVIDENCE_CLASS.PURCHASE_EVIDENCE_COMPLETE}>Purchase evidence exists</option>
              <option value={PURCHASE_EVIDENCE_CLASS.PURCHASE_EVIDENCE_UNMAPPED}>Unmapped purchase evidence</option>
              <option value={PURCHASE_EVIDENCE_CLASS.SUPPLIER_ITEM_UNLINKED}>Missing supplier mapping</option>
              <option value={PURCHASE_EVIDENCE_CLASS.PRICE_WITHOUT_USABLE_UNIT}>Missing pack conversion</option>
              <option value={PURCHASE_EVIDENCE_CLASS.NO_PURCHASE_SOURCE}>No purchase evidence</option>
              <option value={PURCHASE_EVIDENCE_CLASS.OCR_ONLY}>OCR only</option>
            </select>
          </label>
          <ul className="inv-readiness-list" data-testid="inventory-readiness-cost-list">
            {costRows.slice(0, 40).map((row) => (
              <li key={row.ingredientId}>
                <strong>{row.name}</strong>
                {" · "}{row.class}
                {" · "}{row.recoverable ? `recoverable ${row.proposedCost?.value} ${row.proposedCost?.unit}` : row.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
