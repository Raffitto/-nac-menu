/**
 * Unified Sales Intelligence — single premium page (Upload + Coverage + Analytics + Ask NAC shortcuts).
 */

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  Database,
  BarChart3,
  Package,
  Layers,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Users,
  AlertTriangle,
  TrendingUp,
  Clock,
  FileSpreadsheet,
} from "lucide-react";
import FoodicsImportLane from "../components/FoodicsImportLane";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { PERMISSIONS } from "../config/rbac";
import { useRbacOptional } from "../context/RbacContext";
import {
  getMetricLabel,
  getMetricTooltip,
  METRIC_IDS,
} from "../../intelligence/metrics/metricDefinitions";
import { useSalesIntelligenceData } from "./sales/useSalesIntelligenceData";
import { buildSalesIntelligenceDerived } from "./sales/salesIntelligenceDerived";
import { branchDisplayName } from "../utils/rangeState";
import SalesVisibilityPanel from "./sales/SalesVisibilityPanel";
import "../styles/foodics-intelligence.css";
import "../styles/foodics-import-lanes.css";
import "../styles/sales-intelligence.css";

const ASK_NAC_SHORTCUTS = [
  "What were sales in May?",
  "What were the top 10 items last month?",
  "Which item entered the top 10 compared to last month?",
  "Which category generated the most revenue?",
];

function Section({ id, icon: Icon, title, subtitle, children, className = "" }) {
  return (
    <motion.section
      id={id}
      className={`nac-sales-section nac-glass-panel ${className}`.trim()}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <header className="nac-sales-section__head">
        <div className="nac-sales-section__icon">
          <Icon size={18} />
        </div>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </header>
      {children}
    </motion.section>
  );
}

function KpiTile({ label, value, sub, title }) {
  return (
    <div className="nac-sales-kpi" title={title || ""}>
      <span className="nac-sales-kpi__label">{label}</span>
      <strong className="nac-sales-kpi__value">{value}</strong>
      {sub ? <span className="nac-sales-kpi__sub">{sub}</span> : null}
    </div>
  );
}

export default function SalesIntelligenceHub({ onAskNac, initialSection = "upload" }) {
  const rbac = useRbacOptional();
  const canManageImports = rbac?.hasPermission?.(PERMISSIONS.MANAGE_IMPORTS) ?? true;
  const canViewAnalytics = rbac?.hasPermission?.(PERMISSIONS.VIEW_INTELLIGENCE) ?? true;

  const data = useSalesIntelligenceData();
  const derived = useMemo(
    () =>
      buildSalesIntelligenceDerived({
        batches: data.batches,
        salesBatch: data.salesBatch,
        previousBatch: data.previousBatch,
        salesItems: data.salesItems,
        previousSalesItems: data.previousSalesItems,
        topItems: data.topItems,
        totalSessions: data.totalSessions,
      }),
    [data],
  );

  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!canManageImports && !canViewAnalytics) {
    return <p className="nac-empty-state">You do not have access to sales intelligence for this account.</p>;
  }

  const { coverage, overview, items, categories, correlation, waiterIntel } = derived;
  const hasBatch = Boolean(data.salesBatch);

  return (
    <div className="nac-sales-intel">
      <header className="nac-sales-intel__hero">
        <div>
          <p className="nac-sales-intel__kicker">Sales Intelligence</p>
          <h1>Foodics sales · imports · performance</h1>
          <p className="nac-sales-intel__lede">
            One workspace for Foodics uploads, batch coverage, item and category performance, and menu
            visibility correlation.
          </p>
        </div>
        <button type="button" className="nac-sales-intel__refresh" onClick={data.reload} disabled={data.loading}>
          <RefreshCw size={16} className={data.loading ? "nac-bi-spin" : ""} />
          Refresh
        </button>
      </header>

      <div className="nac-sales-intel__notices">
        <p title={getMetricTooltip(METRIC_IDS.AVG_SPEND_PER_GUEST)}>
          <AlertTriangle size={14} />
          {getMetricLabel(METRIC_IDS.AVG_SPEND_PER_GUEST)} requires guest count report — not available yet.
        </p>
        <p title={getMetricTooltip(METRIC_IDS.DELIVERY_SALES)}>
          <AlertTriangle size={14} />
          {getMetricLabel(METRIC_IDS.DELIVERY_SALES)} requires delivery/channel report — not available yet.
        </p>
        <p>
          Menu {getMetricLabel(METRIC_IDS.SESSION).toLowerCase()} are never used as guest counts or POS sales.
        </p>
      </div>

      <Section id="ask-nac" icon={Sparkles} title="Ask NAC shortcuts" subtitle="Jump to verified Foodics answers">
        <div className="nac-sales-ask-chips">
          {ASK_NAC_SHORTCUTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="nac-sales-ask-chip"
              onClick={() => {
                if (typeof onAskNac === "function") {
                  onAskNac(prompt);
                } else if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(prompt);
                }
              }}
            >
              <Sparkles size={14} />
              {onAskNac ? `Ask: ${prompt}` : prompt}
            </button>
          ))}
        </div>
        {!onAskNac ? (
          <p className="nac-sales-ask-hint">Open the Ask NAC tab and paste a prompt above.</p>
        ) : null}
      </Section>

      {canManageImports ? (
        <Section
          id={initialSection === "foodics" ? "upload" : "upload"}
          icon={Upload}
          title="Upload Center"
          subtitle="Operational sales import — Foodics Sales by Creator (group by product)"
        >
          <div className="fi-import-lanes-grid">
            <FoodicsImportLane
              importType={IMPORT_TYPE.WAITER_PRODUCT_SALES}
              latestBatch={data.salesBatch}
              onImported={data.reload}
            />
          </div>
          <p className="nac-sales-upload-note">
            <FileSpreadsheet size={14} />
            Processing status, column mapping, and validation appear inline while you upload. Branch and period
            are set in the upload card before saving.
          </p>
        </Section>
      ) : null}

      {canViewAnalytics ? (
        <>
          <Section icon={Database} title="Data Coverage" subtitle="Uploaded periods and branch batches">
            {data.loading && !data.batches.length ? (
              <p className="nac-empty-state">Loading batch coverage…</p>
            ) : (
              <>
                <div className="nac-sales-coverage-grid">
                  <div className="nac-sales-coverage-card">
                    <h3>Available periods</h3>
                    {coverage.periods.length === 0 ? (
                      <p className="nac-empty-state">No Foodics batches uploaded yet.</p>
                    ) : (
                      <ul>
                        {coverage.periods.slice(0, 8).map((p) => (
                          <li key={p.id}>
                            <strong>{p.start} → {p.end}</strong>
                            <span>{p.branchLabel}{p.file ? ` · ${p.file}` : ""}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="nac-sales-coverage-card">
                    <h3>Branch coverage</h3>
                    {coverage.branchCoverage.length === 0 ? (
                      <p className="nac-empty-state">No branch batches yet.</p>
                    ) : (
                      <ul>
                        {coverage.branchCoverage.map((b) => (
                          <li key={b.id}>
                            <strong>{b.label}</strong>
                            <span>{b.batchCount} batch{b.batchCount === 1 ? "" : "es"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="nac-sales-coverage-card">
                    <h3>Last upload</h3>
                    {coverage.lastUpload ? (
                      <>
                        <p className="nac-sales-last-upload">
                          <Clock size={14} />
                          {coverage.lastUpload.uploadedAt
                            ? new Date(coverage.lastUpload.uploadedAt).toLocaleString()
                            : "—"}
                        </p>
                        <p>{coverage.lastUpload.period} · {coverage.lastUpload.branch}</p>
                        <p className="nac-sales-muted">{coverage.lastUpload.file || "import"}</p>
                      </>
                    ) : (
                      <p className="nac-empty-state">No uploads yet.</p>
                    )}
                  </div>
                </div>
                {coverage.missingMonths.length > 0 ? (
                  <div className="nac-sales-gap-note">
                    <AlertTriangle size={14} />
                    Possible missing months between uploads:{" "}
                    {coverage.missingMonths.map((g) => `${g.label} (${branchDisplayName(g.branchId)})`).join(" · ")}
                  </div>
                ) : null}
              </>
            )}
          </Section>

          <Section icon={BarChart3} title="Sales Overview" subtitle="Latest scoped Foodics batch totals">
            {!hasBatch ? (
              <p className="nac-empty-state">Upload operational sales to see overview KPIs.</p>
            ) : (
              <>
                <p className="nac-sales-batch-label">
                  {overview.batchLabel} · {overview.branchLabel}
                </p>
                <div className="nac-sales-kpi-grid">
                  <KpiTile label="Net sales" value={`${overview.netSales.toLocaleString()} SAR`} />
                  <KpiTile label="Gross sales" value={`${overview.grossSales.toLocaleString()} SAR`} />
                  <KpiTile label="Quantity sold" value={overview.quantity.toLocaleString()} />
                  <KpiTile label="Products / items" value={overview.productCount.toLocaleString()} />
                  <KpiTile
                    label={getMetricLabel(METRIC_IDS.CATEGORY_PERFORMANCE)}
                    value={overview.topCategory?.category || "—"}
                    sub={
                      overview.topCategory
                        ? `${Math.round(overview.topCategory.netSales).toLocaleString()} SAR`
                        : null
                    }
                  />
                </div>
                {correlation.integrityMessage ? (
                  <p className="nac-sales-warning">
                    <AlertTriangle size={14} /> {correlation.integrityMessage}
                  </p>
                ) : null}
              </>
            )}
          </Section>

          <Section icon={Package} title="Item Performance" subtitle="Top items from Foodics import — not menu views">
            {!hasBatch ? (
              <p className="nac-empty-state">Requires operational sales import.</p>
            ) : (
              <div className="nac-sales-dual-grid">
                <div>
                  <h3>Top by net sales</h3>
                  <RankList rows={items.topBySales} valueKey="netSales" suffix=" SAR" />
                </div>
                <div>
                  <h3>Top by quantity</h3>
                  <RankList rows={items.topByQuantity} valueKey="quantity" suffix=" units" />
                </div>
                {data.previousBatch ? (
                  <div className="nac-sales-rank-moves">
                    <h3>Top 10 movement · {items.compareLabel}</h3>
                    <div className="nac-sales-rank-moves__cols">
                      <div>
                        <span className="nac-sales-tag nac-sales-tag--up">Entered top 10</span>
                        {items.rankMoves.entered.length ? (
                          <ul>
                            {items.rankMoves.entered.map((r) => (
                              <li key={r.name}>{r.name}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="nac-sales-muted">None</p>
                        )}
                      </div>
                      <div>
                        <span className="nac-sales-tag nac-sales-tag--down">Dropped from top 10</span>
                        {items.rankMoves.dropped.length ? (
                          <ul>
                            {items.rankMoves.dropped.map((r) => (
                              <li key={r.name}>{r.name}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="nac-sales-muted">None</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Section>

          <Section icon={Layers} title="Category Performance" subtitle="Category sales from Foodics rows">
            {!hasBatch ? (
              <p className="nac-empty-state">Requires operational sales import.</p>
            ) : (
              <div className="nac-sales-table-wrap">
                <table className="fi-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Net sales</th>
                      <th>Quantity</th>
                      {categories.hasComparison ? <th>vs prior batch</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {categories.trend.map((row) => (
                      <tr key={row.category}>
                        <td>{row.category}</td>
                        <td>{Math.round(row.netSales).toLocaleString()} SAR</td>
                        <td>{row.quantity.toLocaleString()}</td>
                        {categories.hasComparison ? (
                          <td>
                            {row.delta == null
                              ? "—"
                              : `${row.delta >= 0 ? "+" : ""}${Math.round(row.delta).toLocaleString()} SAR`}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section icon={TrendingUp} title="Menu visibility vs sales" subtitle="Correlation using existing Foodics + menu behavior engines">
            <SalesVisibilityPanel salesItems={data.salesItems} topItems={data.topItems} />
          </Section>

          <Section icon={Users} title="Waiter performance" subtitle="Waiter leaderboards from creator import">
            {!hasBatch || !waiterIntel.waiters.length ? (
              <p className="nac-empty-state">Requires operational sales import with creator column.</p>
            ) : (
              <div className="nac-sales-waiter-grid">
                {waiterIntel.waiters.slice(0, 8).map((w) => (
                  <div key={w.waiter} className="nac-sales-waiter-row">
                    <span>{w.waiter}</span>
                    <strong>
                      {w.net_sales.toLocaleString()} SAR · {w.quantity} units
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <section className="nac-sales-advanced">
            <button
              type="button"
              className="nac-sales-advanced__toggle"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              Advanced · import history & technical logs
            </button>
            {showAdvanced ? (
              <div className="nac-sales-advanced__body nac-glass-panel">
                <h3>Import history</h3>
                {data.batches.length === 0 ? (
                  <p className="nac-empty-state">No batches yet.</p>
                ) : (
                  <ul className="nac-sales-history-list">
                    {data.batches.map((b) => (
                      <li key={b.id}>
                        <strong>{b.period_start} → {b.period_end}</strong>
                        <span>
                          {b.branch_id} · {b.source_file_name || "import"}
                          {b.uploaded_at ? ` · ${new Date(b.uploaded_at).toLocaleString()}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="nac-sales-muted" style={{ marginTop: "1rem" }}>
                  Full column mapping, validation panels, and import debug output remain in the Upload Center
                  card above — not duplicated here.
                </p>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function RankList({ rows, valueKey, suffix }) {
  if (!rows?.length) return <p className="nac-empty-state">No ranked items.</p>;
  return (
    <ol className="nac-sales-rank-list">
      {rows.map((row) => (
        <li key={row.name}>
          <span>
            #{row.rank} {row.name}
          </span>
          <strong>
            {Number(row[valueKey]).toLocaleString()}
            {suffix}
          </strong>
        </li>
      ))}
    </ol>
  );
}
