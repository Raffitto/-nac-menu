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
import { useMenuBiDashboardContext } from "./context/MenuBiDashboardContext";
import { defaultBranchId } from "./utils/rangeState";
import {
  getImportBatches,
  getBatchSalesItems,
  getLatestBatch,
  getNameMappings,
  persistMappingForRow,
  createImportBatch,
  getMenuItemsForMatching,
  getAddOnsForMatching,
} from "../lib/foodicsApi";
import { parseFoodicsFile, detectColumnMapping, rowsFromMappedData } from "./utils/foodicsParser";
import { IMPORT_TYPE, IMPORT_LANES } from "./config/foodicsImportTypes";
import { BRANCH_OPTIONS } from "./config/foodicsImportTypes";
import { matchImportRows } from "./utils/foodicsMatcher";
import { buildWaiterImportValidation, validationTotalsMatch } from "./utils/waiterImportValidation";
import { buildWaiterImportDebug, isWaiterSavableRow } from "./utils/waiterImportParse";
import WaiterImportValidationPanels from "./components/WaiterImportValidationPanels";
import { groupNeedsReviewRows, displayFoodicsLabel } from "./utils/foodicsImportDedupe";
import { foodicsDedupeKey } from "./utils/foodicsNameNormalize";
import { buildFoodicsSelectCatalog, findCatalogOption } from "./utils/foodicsSelectCatalog";
import { summarizeModifierIntel } from "./utils/foodicsModifierIntel";
import { groupIgnoredRows, IMPORT_STATUS } from "./utils/foodicsImportRules";
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

export default function FoodicsIntelligence({
  importType = IMPORT_TYPE.PRODUCT_SALES,
  embedded = false,
  laneBranch: laneBranchProp,
  onImported,
}) {
  const platform = usePlatformFiltersOptional();
  const { data: biData } = useMenuBiDashboardContext();
  const laneMeta = IMPORT_LANES[importType] || IMPORT_LANES[IMPORT_TYPE.PRODUCT_SALES];
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
  const [parsedRawRows, setParsedRawRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [periodType, setPeriodType] = useState("weekly");
  const [periodStart, setPeriodStart] = useState(weekAgoISO());
  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [laneBranch, setLaneBranch] = useState(
    () => (laneBranchProp || platform?.branch || defaultBranchId()).toLowerCase(),
  );
  const [lastValidation, setLastValidation] = useState(null);
  const [lastSavedMeta, setLastSavedMeta] = useState(null);

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

      const [batchList, items, addons, maps, latest] = await Promise.all([
        getImportBatches(20, importType),
        getMenuItemsForMatching(),
        getAddOnsForMatching(),
        getNameMappings(),
        getLatestBatch(importType, laneBranch),
      ]);

      setBatches(batchList);
      setMenuItems(items);
      setAddOns(addons);
      setManualMaps(maps);
      if (importType === IMPORT_TYPE.PRODUCT_SALES && biData?.top_items?.length) {
        setAnalyticsItems(normalizeTopItems(biData.top_items));
      }

      const activeId = latest?.id;
      if (activeId) {
        setSelectedBatchId(activeId);
        const sales = await getBatchSalesItems(activeId);
        setSalesItems(sales);
        if (importType === IMPORT_TYPE.WAITER_PRODUCT_SALES && sales.length) {
          setLastValidation(buildWaiterImportValidation(sales));
          setLastSavedMeta({
            uploaded_at: latest.uploaded_at,
            source_file_name: latest.source_file_name,
            row_count: sales.length,
          });
        } else if (importType === IMPORT_TYPE.WAITER_PRODUCT_SALES) {
          setLastValidation(null);
          setLastSavedMeta(null);
        }
      } else {
        setSelectedBatchId(null);
        setSalesItems([]);
        if (importType === IMPORT_TYPE.WAITER_PRODUCT_SALES) {
          setLastValidation(null);
          setLastSavedMeta(null);
        }
      }
    } catch (e) {
      setError(e?.message || "Failed to load Foodics data");
    } finally {
      setLoading(false);
    }
  }, [configured, importType, laneBranch, biData?.top_items]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (importType === IMPORT_TYPE.PRODUCT_SALES && biData?.top_items?.length) {
      setAnalyticsItems(normalizeTopItems(biData.top_items));
    }
  }, [importType, biData]);

  const conversionRows = useMemo(() => {
    if (!salesItems.length) return [];
    return buildConversionRows(salesItems, analyticsItems, []);
  }, [salesItems, analyticsItems]);

  const opportunities = useMemo(() => getConversionOpportunities(conversionRows), [conversionRows]);

  const visibilityReady = useMemo(
    () => hasVisibilityTracking(analyticsItems, null),
    [analyticsItems],
  );

  const isWaiterLane = importType === IMPORT_TYPE.WAITER_PRODUCT_SALES;

  const isIgnoredStatus = (s) =>
    s === IMPORT_STATUS.IGNORED ||
    s === IMPORT_STATUS.IGNORED_SELECTION ||
    s === IMPORT_STATUS.IGNORED_FREE_MODIFIER;

  const importableRows = useMemo(() => {
    if (isWaiterLane) {
      return previewRows.filter(isWaiterSavableRow);
    }
    return previewRows.filter(
      (r) => !isIgnoredStatus(r.import_status) && r.import_status !== IMPORT_STATUS.FUTURE_MENU,
    );
  }, [previewRows, isWaiterLane]);
  const ignoredRows = useMemo(
    () => previewRows.filter((r) => isIgnoredStatus(r.import_status)),
    [previewRows],
  );
  const ignoredGroups = useMemo(() => groupIgnoredRows(ignoredRows), [ignoredRows]);
  const futureMenuRows = useMemo(
    () => previewRows.filter((r) => r.import_status === IMPORT_STATUS.FUTURE_MENU),
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

  const modifierPreview = useMemo(
    () =>
      summarizeModifierIntel(
        previewRows.filter(
          (r) => r.import_status === IMPORT_STATUS.MATCHED || r.import_status === IMPORT_STATUS.PAID_MODIFIER,
        ),
      ),
    [previewRows],
  );

  const applyMatching = useCallback(
    (rows) => {
      const matched = matchImportRows(rows, menuItems, manualMaps, addOns, { importType });
      setPreviewRows(matched);
    },
    [menuItems, manualMaps, addOns, importType],
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
      const detected =
        parsed.mapping ||
        detectColumnMapping(parsed.headers, importType);
      if (importType === IMPORT_TYPE.WAITER_PRODUCT_SALES && !detected.waiter) {
        detected.waiter = detectColumnMapping(parsed.headers, IMPORT_TYPE.WAITER_PRODUCT_SALES).waiter;
      }
      setMapping({ ...detected, importType: detected.importType || importType });
      const { rows, error: mapErr } = rowsFromMappedData(parsed.rawRows, detected, { importType });
      if (mapErr) {
        setParsedRawRows([]);
        setError(mapErr);
      } else {
        setParsedRawRows(rows);
        applyMatching(rows);
      }
    } catch (e) {
      setError(e?.message || "Could not parse file");
    }
  }, [applyMatching, importType]);

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
    const { rows, error: mapErr } = rowsFromMappedData(rawRows, mapping, { importType });
    if (mapErr) {
      setError(mapErr);
      return;
    }
    setParsedRawRows(rows);
    applyMatching(rows);
  }, [rawRows, mapping, applyMatching, importType]);

  useEffect(() => {
    if (rawRows.length && mapping.name) remapPreview();
  }, [mapping, rawRows, remapPreview]);

  const importableForSave = useMemo(() => {
    if (isWaiterLane) {
      return previewRows.filter(isWaiterSavableRow);
    }
    return previewRows.filter(
      (r) =>
        (r.import_status === IMPORT_STATUS.MATCHED || r.import_status === IMPORT_STATUS.PAID_MODIFIER) &&
        r.matched_menu_item_name,
    );
  }, [previewRows, isWaiterLane]);

  const rawValidation = useMemo(() => {
    if (!isWaiterLane || !parsedRawRows.length) return null;
    return buildWaiterImportValidation(parsedRawRows.filter(isWaiterSavableRow));
  }, [isWaiterLane, parsedRawRows]);

  const previewValidation = useMemo(() => {
    if (!isWaiterLane || !importableForSave.length) return null;
    return buildWaiterImportValidation(importableForSave);
  }, [isWaiterLane, importableForSave]);

  const pivotMismatch = useMemo(() => {
    if (!rawValidation || !previewValidation) return false;
    return !validationTotalsMatch(rawValidation, previewValidation);
  }, [rawValidation, previewValidation]);

  const importDebug = useMemo(() => {
    if (!isWaiterLane) return null;
    return buildWaiterImportDebug({
      parsedRaw: parsedRawRows,
      previewRows,
      importable: importableForSave,
    });
  }, [isWaiterLane, parsedRawRows, previewRows, importableForSave]);

  const lastSavedLabel = lastSavedMeta
    ? `Saved ${lastSavedMeta.uploaded_at ? new Date(lastSavedMeta.uploaded_at).toLocaleString() : ""}${lastSavedMeta.source_file_name ? ` · ${lastSavedMeta.source_file_name}` : ""}${lastSavedMeta.row_count ? ` · ${lastSavedMeta.row_count} rows in DB` : ""}`
    : null;

  const handleImport = async () => {
    const toSave = importableForSave;
    if (!toSave.length) {
      setError(
        isWaiterLane
          ? "No waiter rows to save. Check Creator column and Gross Sales / Net Quantity."
          : "No matched menu items to save. Resolve items in Needs review first.",
      );
      return;
    }
    setImporting(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const email = session?.session?.user?.email || "admin";
      await createImportBatch(
        {
          branch_id: laneBranch,
          import_type: importType,
          period_type: periodType,
          period_start: periodStart,
          period_end: periodEnd,
          source_file_name: file?.name,
          uploaded_by: email,
          notes: notes || `${laneMeta.title}`,
        },
        toSave,
      );
      const maps = await getNameMappings();
      setManualMaps(maps);
      setFile(null);
      setRawRows([]);
      setPreviewRows([]);
      setParsedRawRows([]);
      if (isWaiterLane) {
        const savedValidation = buildWaiterImportValidation(toSave);
        setLastValidation(savedValidation);
        setLastSavedMeta({
          uploaded_at: new Date().toISOString(),
          source_file_name: file?.name,
          row_count: toSave.length,
        });
      }
      await loadAll();
      onImported?.();
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
    const dedupeKey = foodicsDedupeKey(row.raw_item_name);
    const menuItemId = catalogHit?.id || item?.id || addon?.id || null;

    await persistMappingForRow(row, menuItemName, menuItemId, source);

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

  const mapperFields =
    importType === IMPORT_TYPE.WAITER_PRODUCT_SALES
      ? ["name", "waiter", "sku", "quantity", "netSales", "grossSales", "discount"]
      : ["name", "quantity", "netSales", "grossSales", "discount", "category"];

  const pageClass = embedded ? "fi-page fi-page--embedded" : "fi-page";

  return (
    <motion.div className={pageClass} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {!embedded && (
      <header className="fi-header">
        <motion.div initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <h1>Sales Intelligence</h1>
          <p>Upload Foodics Sales by Product exports and compare real sales to menu behavior.</p>
        </motion.div>
      </header>
      )}

      {error && (
        <motion.div className="fi-alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <AlertTriangle size={16} />
          {error}
        </motion.div>
      )}

      {/* Upload */}
      <section className="fi-card fi-upload-card">
        <h2><Upload size={18} /> {embedded ? laneMeta.title : "Import Foodics Report"}</h2>
        {embedded && <p className="fi-muted" style={{ marginTop: 0 }}>{laneMeta.foodicsReport}</p>}
        <motion.div className="fi-period-row">
          <label>
            Branch
            <select value={laneBranch} onChange={(e) => setLaneBranch(e.target.value)}>
              {BRANCH_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </label>
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
        </motion.div>

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
              {mapperFields.map((field) => (
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

        {modifierPreview.length > 0 && (
          <motion.div className="fi-modifier-preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h3>Modifier / add-on sales ({modifierPreview.length})</h3>
            <p className="fi-muted" style={{ marginBottom: 8 }}>
              Tracked for future attachment-rate and upsell intelligence
            </p>
            <ul className="fi-modifier-list">
              {modifierPreview.slice(0, 8).map((m) => (
                <li key={m.name}>
                  <strong>{m.name}</strong>
                  <span>{m.quantity} units · {Math.round(m.net_sales).toLocaleString()} SAR</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}

        {isWaiterLane && (rawValidation || previewValidation) && (
          <WaiterImportValidationPanels
            rawValidation={rawValidation}
            previewValidation={previewValidation}
            lastSavedValidation={lastValidation}
            lastSavedLabel={lastSavedLabel}
            importDebug={importDebug}
            pivotMismatch={pivotMismatch}
          />
        )}

        {isWaiterLane && importableForSave.length > 0 && (
          <button type="button" className="fi-primary fi-primary--save-waiter" onClick={handleImport} disabled={importing}>
            {importing ? <Loader2 size={16} className="fi-spin" /> : <CheckCircle2 size={16} />}
            Save import ({importableForSave.length} rows ·{" "}
            {importDebug?.saveGross != null
              ? `${importDebug.saveGross.toLocaleString(undefined, { maximumFractionDigits: 2 })} SAR gross`
              : "—"}{" "}
            · {importDebug?.saveQty ?? "—"} qty)
          </button>
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
                    <th>Analytics</th>
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
                      <td><span className="fi-class-pill fi-class-pill--muted">{row.inherited_category || row.analytics_category || "—"}</span></td>
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
                          {row.import_status === IMPORT_STATUS.PAID_MODIFIER
                            ? `Paid modifier${row.upsell_hint ? ` · ${row.upsell_hint}` : ""}`
                            : row.import_status?.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
            {!isWaiterLane && (
              <button type="button" className="fi-primary" onClick={handleImport} disabled={importing}>
                {importing ? <Loader2 size={16} className="fi-spin" /> : <CheckCircle2 size={16} />}
                Save import ({importableForSave.length} matched)
              </button>
            )}
          </div>
        )}

        {ignoredRows.length > 0 && (
          <motion.div className="fi-ignored">
            <button type="button" className="fi-ignored-toggle" onClick={() => setShowIgnored(!showIgnored)}>
              <ChevronDown size={14} className={showIgnored ? "open" : ""} />
              Ignored operational / selection rows ({ignoredRows.length})
            </button>
            <AnimatePresence>
              {showIgnored && (
                <motion.div
                  className="fi-ignored-groups"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  {ignoredGroups.tea.length > 0 && (
                    <motion.div className="fi-ignored-group">
                      <h4>Tea selections ({ignoredGroups.tea.length})</h4>
                      <ul className="fi-ignored-list">
                        {ignoredGroups.tea.map((row) => (
                          <li key={row.raw_item_name}>{displayFoodicsLabel(row)}</li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                  {ignoredGroups.freeModifier.length > 0 && (
                    <motion.div className="fi-ignored-group">
                      <h4>Free modifiers / condiments ({ignoredGroups.freeModifier.length})</h4>
                      <ul className="fi-ignored-list">
                        {ignoredGroups.freeModifier.map((row) => (
                          <li key={row.raw_item_name}>{displayFoodicsLabel(row)}</li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                  {ignoredGroups.promo.length > 0 && (
                    <motion.div className="fi-ignored-group">
                      <h4>Promo / campaign ({ignoredGroups.promo.length})</h4>
                      <ul className="fi-ignored-list">
                        {ignoredGroups.promo.map((row) => (
                          <li key={row.raw_item_name}>{row.raw_item_name}</li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                  {ignoredGroups.other.length > 0 && (
                    <motion.div className="fi-ignored-group">
                      <h4>Other ignored ({ignoredGroups.other.length})</h4>
                      <ul className="fi-ignored-list">
                        {ignoredGroups.other.map((row) => (
                          <li key={row.raw_item_name}>{row.raw_item_name}</li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {futureMenuRows.length > 0 && (
          <motion.section className="fi-card fi-future-menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h2>Future menu items ({futureMenuRows.length})</h2>
            <p className="fi-muted">Not on the NAC menu yet — excluded from matching until added</p>
            <ul className="fi-ignored-list">
              {futureMenuRows.map((row) => (
                <li key={row.raw_item_name}>
                  <strong>{displayFoodicsLabel(row)}</strong>
                </li>
              ))}
            </ul>
          </motion.section>
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

      {/* History — full page only */}
      {!embedded && (
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
      )}

      {/* Opportunities — product lane full page */}
      {!embedded && importType === IMPORT_TYPE.PRODUCT_SALES && conversionRows.length > 0 && (
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
