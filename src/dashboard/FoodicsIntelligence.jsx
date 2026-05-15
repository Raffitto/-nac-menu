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
} from "../lib/foodicsApi";
import { parseFoodicsFile, detectColumnMapping, rowsFromMappedData } from "./utils/foodicsParser";
import { matchImportRows } from "./utils/foodicsMatcher";
import { buildConversionRows, getConversionOpportunities } from "./utils/foodicsConversion";
import { exportCSV } from "./utils/formatters";
import "./styles/foodics-intelligence.css";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [batches, setBatches] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [salesItems, setSalesItems] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [manualMaps, setManualMaps] = useState([]);
  const [analyticsItems, setAnalyticsItems] = useState([]);

  const [file, setFile] = useState(null);
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [previewRows, setPreviewRows] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
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

      const [batchList, items, maps, latest, rpc] = await Promise.all([
        getImportBatches(),
        getMenuItemsForMatching(),
        getNameMappings(),
        getLatestBatch(),
        supabase.rpc("get_bi_dashboard", { p_branch: null, p_hours: 0 }),
      ]);

      setBatches(batchList);
      setMenuItems(items);
      setManualMaps(maps);
      if (rpc.data?.top_items) setAnalyticsItems(rpc.data.top_items);

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
  }, [configured]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const conversionRows = useMemo(() => {
    if (!salesItems.length) return [];
    return buildConversionRows(salesItems, analyticsItems, []);
  }, [salesItems, analyticsItems]);

  const opportunities = useMemo(() => getConversionOpportunities(conversionRows), [conversionRows]);

  const handleFile = useCallback(async (f) => {
    if (!f) return;
    setFile(f);
    setError("");
    try {
      const parsed = await parseFoodicsFile(f);
      setRawRows(parsed.rawRows);
      setHeaders(parsed.headers);
      const detected = detectColumnMapping(parsed.headers);
      setMapping(detected);
      const { rows, error: mapErr } = rowsFromMappedData(parsed.rawRows, detected);
      if (mapErr) setError(mapErr);
      const matched = matchImportRows(rows, menuItems, manualMaps);
      setPreviewRows(matched);
      setUnmatched(matched.filter((r) => r.needs_review));
    } catch (e) {
      setError(e?.message || "Could not parse file");
    }
  }, [menuItems, manualMaps]);

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
    const matched = matchImportRows(rows, menuItems, manualMaps);
    setPreviewRows(matched);
    setUnmatched(matched.filter((r) => r.needs_review));
  }, [rawRows, mapping, menuItems, manualMaps]);

  useEffect(() => {
    if (rawRows.length && mapping.name) remapPreview();
  }, [mapping, rawRows, remapPreview]);

  const handleImport = async () => {
    if (!previewRows.length) return;
    setImporting(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const email = session?.session?.user?.email || "admin";
      await createImportBatch(
        {
          branch_id: "khobar",
          period_type: periodType,
          period_start: periodStart,
          period_end: periodEnd,
          source_file_name: file?.name,
          uploaded_by: email,
          notes,
        },
        previewRows,
      );
      setFile(null);
      setRawRows([]);
      setPreviewRows([]);
      setUnmatched([]);
      await loadAll();
    } catch (e) {
      setError(e?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleManualMap = async (rawName, menuItemName) => {
    const item = menuItems.find((m) => m.name_en === menuItemName);
    await saveNameMapping({
      raw_name: rawName,
      menu_item_name_en: menuItemName,
      menu_item_id: item?.id,
      confidence: 1,
    });
    const maps = await getNameMappings();
    setManualMaps(maps);
    remapPreview();
  };

  const exportConversion = () => {
    const headers = [
      "Item",
      "Menu Views",
      "Orders",
      "Conversion %",
      "Net Sales",
      "Gross Sales",
      "Revenue/View",
      "Status",
    ];
    const rows = conversionRows.map((r) => [
      r.item_name,
      r.item_views,
      r.quantity_sold,
      r.conversion_rate,
      r.net_sales,
      r.gross_sales,
      r.revenue_per_view ?? "",
      r.status,
    ]);
    exportCSV("nac-foodics-conversion.csv", headers, rows);
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

        {previewRows.length > 0 && (
          <div className="fi-preview">
            <h3>Preview ({previewRows.length} rows)</h3>
            <motion.div className="fi-table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <table className="fi-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Net</th>
                    <th>Match</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 12).map((row, i) => (
                    <tr key={i} className={row.needs_review ? "needs-review" : ""}>
                      <td>{row.raw_item_name}</td>
                      <td>{row.quantity_sold}</td>
                      <td>{row.net_sales ?? "—"}</td>
                      <td>{row.matched_menu_item_name || "Unmatched"}</td>
                      <td>{row.match_confidence ? `${Math.round(row.match_confidence * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
            <button type="button" className="fi-primary" onClick={handleImport} disabled={importing}>
              {importing ? <Loader2 size={16} className="fi-spin" /> : <CheckCircle2 size={16} />}
              Save import
            </button>
          </div>
        )}
      </section>

      {/* Unmatched review */}
      <AnimatePresence>
        {unmatched.length > 0 && (
          <motion.section className="fi-card" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0 }}>
            <h2>Needs review ({unmatched.length})</h2>
            <div className="fi-table-wrap">
              <table className="fi-table">
                <thead>
                  <tr>
                    <th>Foodics name</th>
                    <th>Map to menu item</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.slice(0, 20).map((row) => (
                    <tr key={row.raw_item_name}>
                      <td>{row.raw_item_name}</td>
                      <td>
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) handleManualMap(row.raw_item_name, e.target.value);
                          }}
                        >
                          <option value="">Select menu item…</option>
                          {menuItems.map((m) => (
                            <option key={m.id} value={m.name_en}>{m.name_en}</option>
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
          <section className="fi-opps">
            <OpportunityCard
              icon={<Eye size={16} />}
              title="High clicks, low orders"
              rows={opportunities.highClicksLowOrders}
            />
            <OpportunityCard
              icon={<ShoppingCart size={16} />}
              title="High orders, low clicks"
              rows={opportunities.highOrdersLowClicks}
            />
            <OpportunityCard
              icon={<TrendingUp size={16} />}
              title="Best conversion"
              rows={opportunities.bestConversion}
            />
            <OpportunityCard
              icon={<AlertTriangle size={16} />}
              title="Worst conversion"
              rows={opportunities.worstConversion}
            />
          </section>

          <section className="fi-card">
            <motion.div className="fi-card-head" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <h2>Click vs order conversion</h2>
              <button type="button" className="fi-secondary" onClick={exportConversion}>
                <Download size={14} /> Export CSV
              </button>
            </motion.div>
            <div className="fi-table-wrap">
              <table className="fi-table fi-conv-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Views</th>
                    <th>Orders</th>
                    <th>Conv %</th>
                    <th>Net SAR</th>
                    <th>Rev/view</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {conversionRows.slice(0, 50).map((row) => (
                    <tr key={row.item_name}>
                      <td>{row.item_name}</td>
                      <td>{row.item_views}</td>
                      <td>{row.quantity_sold}</td>
                      <td>{row.conversion_rate}%</td>
                      <td>{row.net_sales?.toFixed?.(0) ?? row.net_sales}</td>
                      <td>{row.revenue_per_view ?? "—"}</td>
                      <td><span className="fi-status">{row.status}</span></td>
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
            <span>{r.item_views} views · {r.quantity_sold} orders · {r.conversion_rate}%</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
