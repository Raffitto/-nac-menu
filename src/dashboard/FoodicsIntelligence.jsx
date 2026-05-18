import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  History,
  TrendingUp,
  Eye,
  ShoppingCart,
  ChevronDown,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  getImportBatches,
  getBatchSalesItems,
  getLatestBatch,
  getNameMappings,
  saveNameMapping,
  createImportBatch,
  getMenuItemsForMatching,
  getAddOnsForMatching,
} from "../lib/foodicsApi";
import { parseFoodicsFile, detectColumnMapping, rowsFromMappedData } from "./utils/foodicsParser";
import { matchImportRows } from "./utils/foodicsMatcher";
import { groupNeedsReviewRows, displayFoodicsLabel } from "./utils/foodicsImportDedupe";
import { foodicsDedupeKey } from "./utils/foodicsNameNormalize";
import { buildFoodicsSelectCatalog, findCatalogOption } from "./utils/foodicsSelectCatalog";
import { buildConversionRows, getConversionOpportunities } from "./utils/foodicsConversion";
import { normalizeTopItems } from "./utils/topItemsNormalize";
import { hasVisibilityTracking } from "./utils/intelligenceSanity";
import { exportCSV } from "./utils/formatters";
import { buildExportCommentary } from "./utils/itemBehaviorEngine";
import "./styles/foodics-intelligence.css";
import { usePlatformFiltersOptional } from "./context/PlatformFiltersContext";

const PERIOD_TYPES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function weekAgoISO() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export default function FoodicsIntelligence() {
  const platform = usePlatformFiltersOptional();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [salesItems, setSalesItems] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [addOns, setAddOns] = useState([]);
  const [manualMaps, setManualMaps] = useState([]);
  const [showIgnored, setShowIgnored] = useState(false);
  const [analyticsItems, setAnalyticsItems] = useState([]);

  const [file, setFile] = useState(null);
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [previewRows, setPreviewRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [periodType, setPeriodType] = useState("weekly");
  const [periodStart, setPeriodStart] = useState(weekAgoISO());
  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [notes, setNotes] = useState("");

  const configured = isSupabaseConfigured();

  const loadAll = useCallback(async () => {
    if (!supabase || !configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) {
        setError("Please log in from the Dashboard tab first.");
        setLoading(false);
        return;
      }

      const [batchList, items, addons, maps, latest, rpc] = await Promise.all([
        getImportBatches(),
        getMenuItemsForMatching(),
        getAddOnsForMatching(),
        getNameMappings(),
        getLatestBatch(),
        supabase.rpc("get_bi_dashboard", {
          p_branch: platform?.branch || null,
          p_hours: platform?.timeRangeHours ?? 24,
        }),
      ]);

      setBatches(batchList);
      setMenuItems(items);
      setAddOns(addons);
      setManualMaps(maps);
      if (rpc.data?.top_items) setAnalyticsItems(normalizeTopItems(rpc.data.top_items));

      const activeId = latest?.id;
      if (activeId) {
        setSelectedBatchId(activeId);
        const sales = await getBatchSalesItems(activeId);
        setSalesItems(sales);
      }
    } catch (e) {
      setError(e?.message || "Failed to load Foodics data");
    } finally {
      setLoading(false);
    }
  }, [configured, platform?.branch, platform?.timeRangeHours]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const conversionRows = useMemo(() => {
    if (!salesItems.length) return [];
    return buildConversionRows(salesItems, analyticsItems, []);
  }, [salesItems, analyticsItems]);

  const opportunities = useMemo(() => getConversionOpportunities(conversionRows), [conversionRows]);

  const visibilityReady = useMemo(
    () => hasVisibilityTracking(analyticsItems, null),
    [analyticsItems],
  );

  const importableRows = useMemo(
    () => previewRows.filter((r) => r.import_status !== "ignored"),
    [previewRows],
  );
  const ignoredRows = useMemo(
    () => previewRows.filter((r) => r.import_status === "ignored"),
    [previewRows],
  );
  const needsReviewRows = useMemo(
    () => groupNeedsReviewRows(previewRows),
    [previewRows],
  );

  const mappingCatalog = useMemo(
    () => buildFoodicsSelectCatalog(menuItems, addOns),
    [menuItems, addOns],
  );

  const applyMatching = useCallback(
    (rows, columnMapping) => {
      const matched = matchImportRows(rows, menuItems, manualMaps, addOns);
      setPreviewRows(matched);
    },
    [menuItems, manualMaps, addOns],
  );

  const handleFile = useCallback(async (f) => {
    if (!f) return;
    setFile(f);
    setError("");
    setShowIgnored(false);
    try {
      const parsed = await parseFoodicsFile(f);
      setRawRows(parsed.rawRows);
      setHeaders(parsed.headers);
      const detected = parsed.mapping || detectColumnMapping(parsed.headers);
      setMapping(detected);
      const { rows, error: mapErr } = rowsFromMappedData(parsed.rawRows, detected);
      if (mapErr) setError(mapErr);
      else applyMatching(rows, detected);
    } catch (e) {
      setError(e?.message || "Could not parse file");
    }
  }, [applyMatching]);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const remapPreview = useCallback(() => {
    const { rows, error: mapErr } = rowsFromMappedData(rawRows, mapping);
    if (mapErr) {
      setError(mapErr);
      return;
    }
    applyMatching(rows, mapping);
  }, [rawRows, mapping, applyMatching]);

  useEffect(() => {
    if (rawRows.length && mapping.name) remapPreview();
  }, [mapping, rawRows, remapPreview]);

  const handleImport = async () => {
    const toSave = previewRows.filter(
      (r) => r.import_status === "matched" && r.matched_menu_item_name,
    );
    if (!toSave.length) {
      setError("No matched menu items to save. Resolve items in Needs review first.");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const email = session?.session?.user?.email || "admin";
      await createImportBatch(
        {
          branch_id: (platform?.branch || process.env.REACT_APP_NAC_BRANCH_ID || "khobar").toLowerCase(),
          period_type: periodType,
          period_start: periodStart,
          period_end: periodEnd,
          source_file_name: file?.name,
          uploaded_by: email,
          notes,
        },
        toSave,
      );
      const maps = await getNameMappings();
      setManualMaps(maps);
      setFile(null);
      setRawRows([]);
      setPreviewRows([]);
      await loadAll();
    } catch (e) {
      setError(e?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleManualMap = async (row, menuItemName, source = "manual") => {
    const catalogHit = findCatalogOption(mappingCatalog, menuItemName);
    const item = menuItems.find((m) => m.name_en === menuItemName);
    const addon = addOns.find((a) => a.name_en === menuItemName);
    const variants = row.raw_variants?.length ? row.raw_variants : [row.raw_item_name];
    const dedupeKey = foodicsDedupeKey(row.raw_item_name);
    const menuItemId = catalogHit?.id || item?.id || addon?.id || null;

    await Promise.all(
      variants.map((rawName) =>
        saveNameMapping({
          raw_name: rawName,
          menu_item_name_en: menuItemName,
          menu_item_id: menuItemId,
          confidence: source === "suggestion" ? row.suggested_confidence || 0.85 : 1,
          match_source: source,
        }),
      ),
    );

    const maps = await getNameMappings();
    setManualMaps(maps);
    setPreviewRows((prev) =>
      prev.map((r) => {
        if (foodicsDedupeKey(r.raw_item_name) !== dedupeKey) return r;
        return {
          ...r,
          matched_menu_item_id: menuItemId ? String(menuItemId) : null,
          matched_menu_item_name: menuItemName,
          suggested_menu_item_name: menuItemName,
          suggested_confidence: 1,
          match_confidence: 1,
          match_type: "memory",
          needs_review: false,
          import_status: "matched",
        };
      }),
    );
  };

  const exportConversion = () => {
    const headers = [
      "Item",
      "Impressions",
      "Opens",
      "Deep Interest %",
      "Orders",
      "Visibility vs Sales %",
      "Visual Efficiency",
      "Behavior Type",
      "Confidence",
      "Net Sales",
      "Revenue/Impression",
      "AI Commentary",
    ];
    const rows = conversionRows.map((r) => [
      r.item_name,
      r.item_impressions ?? r.item_views,
      r.item_modal_opens ?? 0,
      r.modal_open_rate ?? r.deep_interest_rate ?? "",
      r.quantity_sold,
      r.impression_conversion_pct ?? r.conversion_rate,
      r.visual_efficiency_score ?? "",
      r.behavior_type || "",
      r.confidence_combined || r.signal_strength || "",
      r.net_sales,
      r.revenue_per_view ?? "",
      buildExportCommentary(r),
    ]);
    const batch = batches.find((b) => b.id === selectedBatchId);
    const batchLabel = batch
      ? `${batch.period_start || "batch"}_${batch.period_end || ""}`.replace(/\s+/g, "")
      : "selected-batch";
    exportCSV(`nac-sales-intelligence-foodics-${batchLabel}.csv`, headers, rows);
  };

  if (!configured) {
    return (
      <motion.div className="fi-page fi-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <FileSpreadsheet size={48} />
        <h2>Sales Intelligence</h2>
        <p>Connect Supabase to import Foodics reports.</p>
      </motion.div>
    );
  }

  if (loading && !batches.length) {
    return (
      <motion.div className="fi-page fi-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Loader2 size={32} className="fi-spin" />
        <p>Loading sales intelligence…</p>
      </motion.div>
    );
  }

  return (
    <motion.div className="fi-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="fi-header">
        <motion.div initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <h1>Sales Intelligence</h1>
          <p>Upload Foodics Sales by Product exports and compare real sales to menu behavior.</p>
        </motion.div>
      </header>

      {error && (
        <motion.div className="fi-alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <AlertTriangle size={16} />
          {error}
        </motion.div>
      )}

      {/* Upload */}
      <section className="fi-card fi-upload-card">
        <h2><Upload size={18} /> Import Foodics Report</h2>
        <div className="fi-period-row">
          {PERIOD_TYPES.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`fi-pill ${periodType === p.value ? "active" : ""}`}
              onClick={() => setPeriodType(p.value)}
            >
              {p.label}
            </button>
          ))}
          <label>
            From
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
          <label className="fi-notes-label">
            Notes
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — e.g. Saturday weekly close"
            />
          </label>
        </div>

        <motion.div
          className={`fi-dropzone ${dragOver ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          whileHover={{ scale: 1.005 }}
        >
          <FileSpreadsheet size={32} />
          <p>Drag & drop CSV or XLSX here</p>
          <label className="fi-file-btn">
            Choose file
            <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleFile(e.target.files?.[0])} hidden />
          </label>
          {file && <span className="fi-file-name">{file.name}</span>}
        </motion.div>

        {headers.length > 0 && (
          <div className="fi-mapper">
            <h3>Column mapping</h3>
            <motion.div className="fi-map-grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {["name", "quantity", "netSales", "grossSales", "discount", "category"].map((field) => (
                <label key={field}>
                  {field}
                  <select
                    value={mapping[field] || ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || null }))}
                  >
                    <option value="">—</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </motion.div>
          </div>
        )}

        {importableRows.length > 0 && (
          <div className="fi-preview">
            <h3>
              Preview ({importableRows.length} importable
              {ignoredRows.length > 0 ? `, ${ignoredRows.length} ignored` : ""})
            </h3>
            <motion.div className="fi-table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <table className="fi-table">
                <thead>
                  <tr>
                    <th>Foodics item</th>
                    <th>Class</th>
                    <th>Qty</th>
                    <th>Net sales</th>
                    <th>Match</th>
                    <th>Suggested</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {importableRows.slice(0, 20).map((row, i) => (
                    <tr key={`${row.normalized_item_name || row.raw_item_name}-${i}`} className={row.import_status === "needs_review" ? "needs-review" : ""}>
                      <td>{displayFoodicsLabel(row)}</td>
                      <td><span className="fi-class-pill">{row.foodics_class_label || "—"}</span></td>
                      <td>{row.quantity_sold}</td>
                      <td>{row.net_sales ?? "—"}</td>
                      <td>{row.matched_menu_item_name || "—"}</td>
                      <td>
                        {row.suggested_menu_item_name && row.import_status === "needs_review"
                          ? `${row.suggested_menu_item_name} (${Math.round((row.suggested_confidence || 0) * 100)}%)`
                          : row.suggested_menu_item_name || "—"}
                      </td>
                      <td>
                        <span className={`fi-status-pill ${row.import_status}`}>
                          {row.import_status?.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
            <button type="button" className="fi-primary" onClick={handleImport} disabled={importing}>
              {importing ? <Loader2 size={16} className="fi-spin" /> : <CheckCircle2 size={16} />}
              Save import ({previewRows.filter((r) => r.import_status === "matched").length} matched)
            </button>
          </div>
        )}

        {ignoredRows.length > 0 && (
          <motion.div className="fi-ignored">
            <button type="button" className="fi-ignored-toggle" onClick={() => setShowIgnored(!showIgnored)}>
              <ChevronDown size={14} className={showIgnored ? "open" : ""} />
              Ignored operational rows ({ignoredRows.length})
            </button>
            <AnimatePresence>
              {showIgnored && (
                <motion.ul
                  className="fi-ignored-list"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  {ignoredRows.slice(0, 40).map((row) => (
                    <li key={row.raw_item_name}>{row.raw_item_name}</li>
                  ))}
                  {ignoredRows.length > 40 && <li>…and {ignoredRows.length - 40} more</li>}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </section>

      {/* Unmatched review */}
      <AnimatePresence>
        {needsReviewRows.length > 0 && (
          <motion.section className="fi-card" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0 }}>
            <h2>Needs review ({needsReviewRows.length})</h2>
            <div className="fi-table-wrap">
              <table className="fi-table">
                <thead>
                  <tr>
                    <th>Foodics name</th>
                    <th>Class</th>
                    <th>Suggestion</th>
                    <th>Map to NAC item</th>
                  </tr>
                </thead>
                <tbody>
                  {needsReviewRows.slice(0, 30).map((row) => (
                    <tr key={row.normalized_item_name || row.raw_item_name}>
                      <td>{displayFoodicsLabel(row)}</td>
                      <td><span className="fi-class-pill">{row.foodics_class_label || "—"}</span></td>
                      <td>
                        {row.suggested_menu_item_name ? (
                          <span className="fi-suggestion">
                            {row.suggested_menu_item_name}
                            {" · "}
                            {Math.round((row.suggested_confidence || 0) * 100)}%
                            <button
                              type="button"
                              className="fi-suggestion-accept"
                              onClick={() => handleManualMap(row, row.suggested_menu_item_name, "suggestion")}
                            >
                              Confirm
                            </button>
                          </span>
                        ) : (
                          <span className="fi-muted">No suggestion</span>
                        )}
                      </td>
                      <td>
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) handleManualMap(row, e.target.value, "manual");
                          }}
                        >
                          <option value="">Select unique menu option…</option>
                          {mappingCatalog.options.map((opt) => (
                            <option key={opt.key} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* History */}
      <section className="fi-card">
        <h2><History size={18} /> Import history</h2>
        {batches.length === 0 ? (
          <p className="fi-muted">No Foodics imports yet. Upload a weekly Sales by Product export to unlock sales conversion intelligence.</p>
        ) : (
          <div className="fi-batch-list">
            {batches.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`fi-batch ${selectedBatchId === b.id ? "active" : ""}`}
                onClick={async () => {
                  setSelectedBatchId(b.id);
                  const sales = await getBatchSalesItems(b.id);
                  setSalesItems(sales);
                }}
              >
                <span>{b.period_start} → {b.period_end}</span>
                <span className="fi-batch-meta">{b.period_type} · {b.source_file_name || "import"}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Opportunities */}
      {conversionRows.length > 0 && (
        <>
          {!visibilityReady && (
            <p className="fi-visibility-note">
              Collecting visibility signals — impression data will sharpen guest attention metrics. Until then, deep interest (opens) is used as a fallback.
            </p>
          )}
          <section className="fi-opps">
            <OpportunityCard
              icon={<Eye size={16} />}
              title="High attention, low sales"
              rows={opportunities.highVisibilityLowOrders || opportunities.highClicksLowOrders}
            />
            <OpportunityCard
              icon={<ShoppingCart size={16} />}
              title="Strong sales, low visibility"
              rows={opportunities.highOrdersLowVisibility || opportunities.highOrdersLowClicks}
            />
            <OpportunityCard
              icon={<TrendingUp size={16} />}
              title="Visual sellers"
              rows={opportunities.visualSellers}
            />
            <OpportunityCard
              icon={<TrendingUp size={16} />}
              title="Strong visibility efficiency"
              rows={opportunities.bestConversion}
            />
            <OpportunityCard
              icon={<AlertTriangle size={16} />}
              title="Needs sales attention"
              rows={opportunities.worstConversion}
            />
          </section>

          <section className="fi-card">
            <motion.div className="fi-card-head" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <h2>Visibility vs sales</h2>
              <button type="button" className="fi-secondary" onClick={exportConversion}>
                <Download size={14} /> Export CSV
              </button>
            </motion.div>
            <div className="fi-table-wrap">
              <table className="fi-table fi-conv-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Impressions</th>
                    <th>Opens</th>
                    <th>Open rate</th>
                    <th>Orders</th>
                    <th>Imp. conv</th>
                    <th>Visual eff.</th>
                    <th>Behavior</th>
                    <th>Confidence</th>
                    <th>Net SAR</th>
                  </tr>
                </thead>
                <tbody>
                  {conversionRows.slice(0, 50).map((row) => (
                    <tr key={row.item_name}>
                      <td>{row.item_name}</td>
                      <td>{row.item_impressions ?? row.item_views ?? "—"}</td>
                      <td>{row.item_modal_opens ?? "—"}</td>
                      <td>{row.modal_open_rate != null ? `${row.modal_open_rate}%` : "—"}</td>
                      <td>{row.quantity_sold}</td>
                      <td className="fi-conv-cell">{row.conversion_display || (row.impression_conversion_pct != null ? `${row.impression_conversion_pct}%` : "—")}</td>
                      <td>{row.visual_efficiency_score ?? row.attention_score ?? "—"}</td>
                      <td><span className="fi-behavior-type">{row.behavior_type || "—"}</span></td>
                      <td className="fi-confidence">{row.signal_strength || "—"}</td>
                      <td>{row.net_sales?.toFixed?.(0) ?? row.net_sales}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </motion.div>
  );
}

function OpportunityCard({ icon, title, rows }) {
  if (!rows?.length) return null;
  return (
    <motion.div className="fi-opp-card" whileHover={{ y: -2 }}>
      <div className="fi-opp-head">{icon}<h3>{title}</h3></div>
      <ul>
        {rows.map((r) => (
          <li key={r.item_name}>
            <strong>{r.item_name}</strong>
            <span>{r.item_views} views · {r.quantity_sold} orders · {r.conversion_display || `${r.menu_conversion_pct ?? r.conversion_rate}%`}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
