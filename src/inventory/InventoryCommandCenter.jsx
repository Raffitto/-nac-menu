import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  fetchInventoryVarianceAnalysis,
  setInventoryVarianceReview,
} from "../lib/inventoryApi";
import { VARIANCE_REVIEW_STATUSES } from "./varianceIntelligence";
import { formatSar } from "./costTrust";

const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "variance", label: "Variance" },
  { id: "exceptions", label: "Exceptions" },
];

const SEVERITIES = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"];

function dateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function defaultPeriod() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { start: dateInputValue(start), end: dateInputValue(end) };
}

function humanize(value) {
  return String(value || "—").replaceAll("_", " ").toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function formatQuantity(value, unit) {
  if (value == null) return "Unavailable";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit || ""}`.trim();
}

function SummaryCard({ value, label, tone = "" }) {
  return (
    <article className={tone ? `inv-command-metric inv-command-metric--${tone}` : "inv-command-metric"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function FlowRow({ label, value, unit, direction }) {
  return (
    <div className="inv-command-flow-row">
      <span>{label}</span>
      <strong className={direction ? `inv-command-flow--${direction}` : ""}>
        {formatQuantity(value, unit)}
      </strong>
    </div>
  );
}

export default function InventoryCommandCenter({ branchId }) {
  const initialPeriod = useMemo(defaultPeriod, []);
  const [periodStart, setPeriodStart] = useState(initialPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(initialPeriod.end);
  const [view, setView] = useState("overview");
  const [severity, setSeverity] = useState("ALL");
  const [reviewStatus, setReviewStatus] = useState("ALL");
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchInventoryVarianceAnalysis({
        branchId,
        periodStart,
        periodEnd,
      });
      setData(next);
      setSelected((current) => (
        current ? next.items.find((item) => item.inventoryItemId === current.inventoryItemId) || null : null
      ));
    } catch (err) {
      setError(err?.message || "Could not load inventory intelligence.");
    } finally {
      setLoading(false);
    }
  }, [branchId, periodStart, periodEnd]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const items = data?.items || [];
  const filtered = items.filter((item) => (
    (severity === "ALL" || item.severity === severity)
    && (reviewStatus === "ALL" || item.review?.status === reviewStatus)
  ));
  const exceptions = items.flatMap((item) => (
    (item.openExceptions || []).map((exception) => ({
      ...exception,
      inventoryItemId: item.inventoryItemId,
      itemName: item.itemName,
    }))
  ));
  const summary = data?.summary || {};

  const handleReview = async (item, status) => {
    const reason = window.prompt(`Reason for ${humanize(status)}:`);
    if (!reason?.trim()) return;
    setBusy(item.inventoryItemId);
    setError("");
    try {
      await setInventoryVarianceReview({
        branchId,
        ingredientId: item.inventoryItemId,
        periodStart,
        periodEnd,
        status,
        reason: reason.trim(),
        countSessionId: item.countQuality?.countSessionId,
        stockCountId: item.countQuality?.stockCountId,
      });
      setNotice(`Variance marked ${humanize(status)}.`);
      await refresh();
    } catch (err) {
      setError(err?.message || "Could not update variance review.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="inv-command-center" data-testid="inventory-command-center">
      {(error || notice) ? (
        <div className={`inv-banner ${error ? "inv-banner--error" : "inv-banner--success"}`}>
          {error ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          <span>{error || notice}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => { setError(""); setNotice(""); }}>
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="inv-command-toolbar">
        <div className="inv-command-view-tabs" role="tablist" aria-label="Inventory command center views">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`inv-tab${view === entry.id ? " inv-tab--active" : ""}`}
              onClick={() => setView(entry.id)}
              data-testid={`command-view-${entry.id}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <label>
          <span>From</span>
          <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
        </label>
        <button type="button" className="inv-button inv-button--secondary" onClick={refresh} disabled={loading}>
          <RefreshCw size={15} className={loading ? "inv-spin" : ""} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="inv-ingredients-state">
          <Loader2 size={22} className="inv-spin" /> Loading deterministic variance intelligence…
        </div>
      ) : view === "overview" ? (
        <>
          <div className="inv-command-metrics">
            <SummaryCard value={summary.critical || 0} label="Critical" tone="critical" />
            <SummaryCard value={summary.high || 0} label="High priority" tone="high" />
            <SummaryCard value={summary.countQualityIssues || 0} label="Count quality issues" />
            <SummaryCard value={summary.negativeTheoreticalStock || 0} label="Negative theoretical stock" />
            <SummaryCard value={summary.missingRecipeCoverage || 0} label="Recipe coverage gaps" />
            <SummaryCard value={summary.untrustedValueCount || 0} label="Untrusted SAR values" />
            <SummaryCard value={`${data?.recipeCoveragePct || 0}%`} label="Trusted product coverage" />
            <SummaryCard value={formatSar(summary.totalTrustedVarianceValue)} label="Trusted absolute variance" />
          </div>
          <div className="inv-command-callout">
            <AlertTriangle size={18} />
            <div>
              <strong>Recipe consumption gate</strong>
              <p>
                {data?.theoreticalConsumptionAvailable
                  ? "Trusted recipe coverage is sufficient for theoretical-consumption analysis."
                  : data?.theoreticalConsumptionReason === "RECIPE_COVERAGE_GAP"
                    ? "Theoretical ingredient consumption is unavailable because trusted recipe coverage is incomplete."
                    : "Theoretical ingredient consumption is unavailable because sales/order consumption is not reliably linked to recipes."}
              </p>
            </div>
          </div>
          <VarianceTable
            items={items.filter((item) => item.materiality?.prioritized).slice(0, 10)}
            onSelect={setSelected}
          />
        </>
      ) : view === "exceptions" ? (
        <div className="inv-ingredients-table-wrap">
          <table className="inv-ingredients-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Exception</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Detected</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.length ? exceptions.map((exception) => (
                <tr key={exception.exceptionId}>
                  <td>{exception.itemName}</td>
                  <td>{humanize(exception.exceptionType)}</td>
                  <td>{humanize(exception.severity)}</td>
                  <td>{humanize(exception.status)}</td>
                  <td>{exception.detectedAt?.slice(0, 10) || "—"}</td>
                </tr>
              )) : (
                <tr><td colSpan={5}>No open inventory exceptions in this view.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="inv-command-filters">
            <label>
              <span>Severity</span>
              <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                {SEVERITIES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Review status</span>
              <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)}>
                <option value="ALL">All</option>
                {VARIANCE_REVIEW_STATUSES.map((value) => (
                  <option key={value} value={value}>{humanize(value)}</option>
                ))}
              </select>
            </label>
          </div>
          <VarianceTable items={filtered} onSelect={setSelected} />
        </>
      )}

      {selected ? (
        <VarianceDetail
          item={selected}
          busy={busy === selected.inventoryItemId}
          onClose={() => setSelected(null)}
          onReview={handleReview}
        />
      ) : null}
    </section>
  );
}

function VarianceTable({ items, onSelect }) {
  return (
    <div className="inv-ingredients-table-wrap">
      <table className="inv-ingredients-table" data-testid="inventory-variance-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Variance quantity</th>
            <th>Variance value</th>
            <th>Primary cause</th>
            <th>Confidence</th>
            <th>Severity</th>
            <th>Status</th>
            <th><span className="inv-sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {items.length ? items.map((item) => (
            <tr key={item.inventoryItemId}>
              <td>
                <strong>{item.itemName}</strong>
                <div className="inv-ingredients-note">As of {item.analysisAsOf}</div>
              </td>
              <td>{formatQuantity(item.varianceQuantity, item.canonicalUnit)}</td>
              <td>{item.varianceValue == null ? "Unavailable" : formatSar(item.varianceValue)}</td>
              <td>{humanize(item.primaryCause)}</td>
              <td>{humanize(item.confidence)}</td>
              <td><span className={`inv-status-pill inv-status-pill--${item.severity.toLowerCase()}`}>{item.severity}</span></td>
              <td>{humanize(item.review?.status || "OPEN")}</td>
              <td>
                <button
                  type="button"
                  className="inv-button inv-button--ghost"
                  onClick={() => onSelect(item)}
                  aria-label={`Explain ${item.itemName}`}
                >
                  <ChevronRight size={16} />
                </button>
              </td>
            </tr>
          )) : (
            <tr><td colSpan={8}>No inventory items match this view.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function VarianceDetail({ item, busy, onClose, onReview }) {
  const actual = item.actual || {};
  return (
    <div className="inv-ingredients-panel-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="inv-ingredients-panel inv-command-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`Variance explanation for ${item.itemName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="inv-ingredients-panel-header">
          <div>
            <p className="inv-kicker">Inventory variance</p>
            <h2>{item.itemName}</h2>
            <p>{item.periodStart} to {item.analysisAsOf} · {item.canonicalUnit}</p>
          </div>
          <button type="button" className="inv-button inv-button--ghost" onClick={onClose} aria-label="Close variance detail">
            <X size={16} />
          </button>
        </header>

        <div className="inv-command-detail-body">
          <section>
            <h3>Standard → Actual → Variance</h3>
            <FlowRow label="Opening stock" value={item.openingQuantity} unit={item.canonicalUnit} />
            <FlowRow label="Purchases" value={actual.purchases} unit={item.canonicalUnit} direction="in" />
            <FlowRow label="Returns to supplier" value={actual.returnsToSupplier} unit={item.canonicalUnit} direction="out" />
            <FlowRow label="Transfers in" value={actual.transfersIn} unit={item.canonicalUnit} direction="in" />
            <FlowRow label="Transfers out" value={actual.transfersOut} unit={item.canonicalUnit} direction="out" />
            <FlowRow label="Staff meals" value={actual.staffMeal} unit={item.canonicalUnit} direction="out" />
            <FlowRow label="Operational disposal" value={actual.operationalDisposal} unit={item.canonicalUnit} direction="out" />
            <FlowRow label="Recorded waste" value={actual.recordedWaste} unit={item.canonicalUnit} direction="out" />
            <FlowRow label="Production input" value={actual.productionInput} unit={item.canonicalUnit} direction="out" />
            <FlowRow label="Production output" value={actual.productionOutput} unit={item.canonicalUnit} direction="in" />
            <FlowRow label="Actual order consumption" value={actual.actualOrderConsumption} unit={item.canonicalUnit} direction="out" />
            <FlowRow label="Adjustments (net)" value={actual.adjustmentsNet} unit={item.canonicalUnit} />
            <FlowRow label="Expected closing" value={item.expectedClosing} unit={item.canonicalUnit} />
            <FlowRow label="Physical closing" value={item.physicalClosing} unit={item.canonicalUnit} />
            <FlowRow label="Variance" value={item.varianceQuantity} unit={item.canonicalUnit} />
            <FlowRow label="Variance value" value={item.varianceValue == null ? null : item.varianceValue} unit={item.varianceValue == null ? "" : "SAR"} />
          </section>

          <section>
            <h3>Cause → Action</h3>
            <div className="inv-command-cause">
              <span className={`inv-status-pill inv-status-pill--${item.severity.toLowerCase()}`}>{item.severity}</span>
              <strong>{humanize(item.primaryCause)}</strong>
              <span>{item.confidence} confidence</span>
            </div>
            {item.contributingCauses?.length ? (
              <p>Contributing: {item.contributingCauses.map(humanize).join(", ")}</p>
            ) : null}
            <p><strong>Suggested action:</strong> {item.suggestedAction}</p>
            {item.theoreticalRecipeConsumption == null ? (
              <div className="inv-command-callout">
                <AlertTriangle size={16} />
                <p>
                  {Number(item.recipeCoveragePct || 0) < 80
                    ? `Theoretical ingredient consumption is unavailable because trusted recipe coverage is ${item.recipeCoveragePct}%.`
                    : "Theoretical ingredient consumption is unavailable because sales/order consumption is not reliably linked to recipes."}
                </p>
              </div>
            ) : null}
          </section>

          <section>
            <h3>Count quality</h3>
            <p>
              Locations counted: {item.countQuality?.countedLocationCount ?? "—"} /
              {" "}{item.countQuality?.selectedLocationCount ?? "—"}
            </p>
            {(item.countQuality?.warnings || []).map((warning, index) => (
              <div key={`${warning.code}-${index}`} className="inv-command-evidence">
                <strong>{humanize(warning.code)}</strong>
                <span>{warning.message}</span>
              </div>
            ))}
            {item.firstNegativeTheoreticalDate ? (
              <div className="inv-command-evidence">
                <strong>Expected stock first became negative</strong>
                <span>{item.firstNegativeTheoreticalDate}</span>
              </div>
            ) : null}
          </section>

          <section>
            <h3>Evidence timeline</h3>
            {(item.evidence?.movements || []).length ? (
              (item.evidence.movements || []).map((movement) => (
                <div key={movement.movementId} className="inv-command-evidence">
                  <strong>{movement.businessDate} · {humanize(movement.movementType)}</strong>
                  <span>{formatQuantity(movement.quantity, item.canonicalUnit)}</span>
                  <small>{movement.sourceReference || movement.reasonCode || movement.movementId}</small>
                </div>
              ))
            ) : <p>No posted movements in the selected period.</p>}
            {item.relatedSkuEvidence ? (
              <div className="inv-command-evidence">
                <strong>Opposing related-SKU variance</strong>
                <span>Combined: {formatQuantity(item.relatedSkuEvidence.combinedVariance, item.canonicalUnit)}</span>
              </div>
            ) : null}
          </section>

          <section>
            <h3>Review workflow</h3>
            <p>Current status: <strong>{humanize(item.review?.status || "OPEN")}</strong></p>
            <div className="inv-command-review-actions">
              {["REVIEWING", "EXPLAINED", "ACTION_REQUIRED", "RESOLVED", "DISMISSED"].map((status) => (
                <button
                  key={status}
                  type="button"
                  className="inv-button inv-button--secondary"
                  onClick={() => onReview(item, status)}
                  disabled={busy}
                >
                  {humanize(status)}
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
