import React, { useCallback, useEffect, useMemo, useState } from "react";
import { nacPreviousBusinessWeekRange, riyadhIsoDate } from "../intelligence/askNac/shared/nacBusinessWeek";
import { fetchInventoryStaffAccess } from "../lib/inventoryApi";
import {
  buildInventoryTruthResult,
  fetchInventoryTruthFoundation,
  fetchInventoryTruthSales,
} from "../lib/inventoryTruthApi";
import { exploreIngredient, traceIngredientQuantity } from "./truth";

function pct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "Unavailable";
  return `${Math.round(Number(value) * 100)}%`;
}

function money(value) {
  if (value == null || value === "") return "Unavailable";
  return `SAR ${value}`;
}

function ReadinessGrid({ readiness }) {
  const rows = [
    ["Recipe coverage", readiness?.recipeCoverage],
    ["Ingredient identity", readiness?.ingredientIdentityHealth],
    ["UOM health", readiness?.uomHealth],
    ["Cost coverage", readiness?.costCoverage],
    ["Theoretical consumption", readiness?.theoreticalConsumptionReadiness],
    ["Actual consumption", readiness?.actualConsumptionReadiness],
    ["Variance", readiness?.varianceReadiness],
  ];
  return (
    <dl className="inv-truth-readiness" data-testid="inventory-truth-readiness">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || "UNAVAILABLE"}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function InventoryTruthView({
  branchId,
  access: accessProp = null,
  rbacProfile = null,
  embedded = false,
}) {
  const priorWeek = useMemo(() => nacPreviousBusinessWeekRange(riyadhIsoDate()), []);
  const [periodStart, setPeriodStart] = useState(priorWeek.startDate);
  const [periodEnd, setPeriodEnd] = useState(priorWeek.endDate);
  const [foundation, setFoundation] = useState(null);
  const [engine, setEngine] = useState(null);
  const [access, setAccess] = useState(accessProp);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const loadFoundation = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const staffAccess = accessProp || await fetchInventoryStaffAccess();
      setAccess(staffAccess);
      const payload = await fetchInventoryTruthFoundation({ branchId, access: staffAccess, rbacProfile });
      setFoundation(payload);
      setEngine(buildInventoryTruthResult(payload));
    } catch (err) {
      setError(err?.message || "Inventory Truth source unavailable");
      setFoundation(null);
      setEngine(null);
    } finally {
      setLoading(false);
    }
  }, [branchId, accessProp, rbacProfile]);

  useEffect(() => {
    loadFoundation();
  }, [loadFoundation]);

  const computeTheoretical = async () => {
    if (!foundation) return;
    setComputing(true);
    setError("");
    try {
      const sales = await fetchInventoryTruthSales({
        branchId,
        periodStart,
        periodEnd,
        access,
        rbacProfile,
      });
      setEngine(buildInventoryTruthResult(foundation, sales));
    } catch (err) {
      setError(err?.message || "Sales source unavailable");
    } finally {
      setComputing(false);
    }
  };

  const identities = engine?.identity?.identities || [];
  const filtered = identities.filter((row) => {
    if (!query.trim()) return true;
    return `${row.displayName} ${row.sku || ""}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const selected = selectedId
    ? exploreIngredient(selectedId, {
      theoretical: engine?.theoretical,
      identities: engine?.identity,
      graph: engine?.graph,
    })
    : null;
  const selectedCost = engine?.costs?.find((row) => row.ingredientId === selectedId) || selected?.cost || null;
  const selectedTrace = selectedId && engine ? traceIngredientQuantity(selectedId, engine) : null;

  return (
    <section className={`inv-truth${embedded ? " inv-truth--embedded" : ""}`} data-testid="inventory-truth-view">
      <div className="inv-summary">
        <div>
          <p className="inv-kicker">Inventory Truth Engine</p>
          <h2>What should have been consumed</h2>
          <p>
            Theoretical consumption from mapped sales × recipe graph. Missing cost, stock, or UOM stays
            unavailable — never zero.
          </p>
        </div>
      </div>

      {loading ? <p className="inv-empty">Loading inventory foundation…</p> : null}
      {error ? <p className="inv-error" role="alert">{error}</p> : null}

      {engine ? (
        <>
          <ReadinessGrid readiness={engine.readiness} />
          <p className="inv-muted" data-testid="inventory-truth-actual">
            Actual consumption: {engine.actual.actualCoverageStatus}
            {engine.actual.note ? ` — ${engine.actual.note}` : ""}
          </p>
          <p className="inv-muted" data-testid="inventory-truth-cost">
            Costed ingredients: {engine.costSummary.valid}
            {" · "}
            Actionable missing: {engine.costSummary.actionableMissing}
            {" · "}
            OCR placeholders: {engine.costSummary.ocrPlaceholders}
            {" · "}
            Coverage {pct(engine.costSummary.coveragePct)}
          </p>
          <p className="inv-muted">
            Recipe graph issues: {engine.graph.issues.length}
            {" · "}
            UOM convertible {engine.uom.convertible}
            {" · "}
            UOM blocked {engine.uom.blocked}
          </p>

          <div className="inv-truth-period">
            <label>
              <span>From</span>
              <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
            </label>
            <button type="button" className="inv-button" onClick={computeTheoretical} disabled={computing}>
              {computing ? "Calculating…" : "Calculate theoretical"}
            </button>
          </div>

          {engine.theoretical.coverage.soldItemRows > 0 ? (
            <p className="inv-muted" data-testid="inventory-truth-sales-coverage">
              Source {engine.theoretical.source || "unavailable"}
              {" · "}
              Requested {engine.theoretical.salesCoverage?.requestedStart || engine.period.start || "—"}
              {"–"}
              {engine.theoretical.salesCoverage?.requestedEnd || engine.period.end || "—"}
              {" · "}
              Available {engine.theoretical.salesCoverage?.availableStart || engine.period.start || "—"}
              {"–"}
              {engine.theoretical.salesCoverage?.availableEnd || engine.period.end || "—"}
              {" · "}
              Published through {engine.theoretical.salesCoverage?.publishedThrough || "unknown"}
              {" · "}
              Sold rows {engine.theoretical.coverage.soldItemRows}
              {" · "}
              Recipe-covered {engine.theoretical.coverage.recipeCoveredSoldRows}
              {" · "}
              Uncovered {engine.theoretical.coverage.recipeUncoveredSoldRows}
              {" · "}
              Recipe coverage {pct(engine.theoretical.coverage.recipeCoveragePct)}
              {" · "}
              Theoretical food cost {money(engine.foodCost.calculatedTheoreticalFoodCost)}
              {" · "}
              Uncosted ingredients {engine.foodCost.uncostedIngredientCount}
            </p>
          ) : (
            <p className="inv-muted">Theoretical sales coverage is not calculated until a period is run.</p>
          )}

          <div className="inv-truth-explorer">
            <label>
              <span>Ingredient explorer</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search honey, Maldon, steak…"
              />
            </label>
            <ul className="inv-truth-list" data-testid="inventory-truth-ingredient-list">
              {filtered.slice(0, 80).map((row) => (
                <li key={row.canonicalIngredientId}>
                  <button
                    type="button"
                    className={selectedId === row.canonicalIngredientId ? "inv-tab inv-tab--active" : "inv-tab"}
                    onClick={() => setSelectedId(row.canonicalIngredientId)}
                  >
                    {row.displayName}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {selected ? (
            <div className="inv-workspace" data-testid="inventory-truth-explorer">
              <h3>{selected.identity?.displayName || "Ingredient"}</h3>
              <dl className="inv-truth-dl">
                <div><dt>Canonical ID</dt><dd>{selected.identity?.canonicalIngredientId || "Unavailable"}</dd></div>
                <div><dt>SKU</dt><dd>{selected.identity?.sku || "Not known"}</dd></div>
                <div><dt>Base UOM</dt><dd>{selected.identity?.baseUom || "Unavailable"}</dd></div>
                <div><dt>Cost</dt><dd>{money(selectedCost?.value)} ({selectedCost?.coverageStatus || "UNKNOWN"})</dd></div>
                <div><dt>Cost source</dt><dd>{selectedCost?.source || "Unavailable"}</dd></div>
                <div><dt>Theoretical</dt><dd>{selected.theoreticalConsumption ?? "Unavailable"} {selected.identity?.baseUom || ""}</dd></div>
                <div><dt>Actual</dt><dd>Unavailable</dd></div>
                <div><dt>Variance</dt><dd>Not computable</dd></div>
              </dl>
              <p className="inv-muted">Recipes: {(selected.recipes || []).map((row) => row.recipeName || row.displayName).join(", ") || "None in loaded graph"}</p>
              <p className="inv-muted">Menu drivers: {(selected.menuItems || []).map((row) => `${row.displayName} × ${row.soldQuantity}`).join(", ") || "No sales period calculated"}</p>
              {selectedTrace?.traces?.length ? (
                <ol data-testid="inventory-truth-trace">
                  {selectedTrace.traces.map((trace, index) => (
                    <li key={`${trace.soldMenuItemId}-${index}`}>
                      {trace.soldMenuItemName} sold {trace.soldQuantity}
                      {" → "}
                      {(trace.path || []).map((step) => `${step.recipeName} (${step.lineQuantity} ${step.unit})`).join(" → ")}
                      {" → "}
                      {trace.contributionBaseQty} {trace.baseUom}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="inv-muted">No theoretical trace for this period.</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
