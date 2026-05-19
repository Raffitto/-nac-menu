import React, { useMemo, useState } from "react";
import { DEFAULT_WEEKLY_FOCUS_ITEMS } from "../config/weeklyFocusStorage";
import { motion } from "framer-motion";
import { Settings2, FileText, Download } from "lucide-react";
import {
  EXPORT_SECTIONS,
  EXPORT_TARGET_MODES,
  WAITER_SORT_OPTIONS,
  PRODUCT_SORT_OPTIONS,
  applyTargetMode,
} from "../config/visualExportPresets";
import { BRANCH_OPTIONS } from "../config/foodicsImportTypes";

export default function VisualExportConfig({
  config,
  onChange,
  waiterNames = [],
  focusCatalog = [],
  onExportPdf,
  onExportXlsx,
  exporting = false,
}) {
  const [focusSearch, setFocusSearch] = useState("");

  const filteredWaiters = useMemo(() => {
    const q = (config.waiterSearch || "").trim().toLowerCase();
    if (!q) return waiterNames;
    return waiterNames.filter((w) => w.toLowerCase().includes(q));
  }, [waiterNames, config.waiterSearch]);

  const set = (patch) => onChange({ ...config, ...patch });

  const toggleSection = (id) => {
    set({
      sections: { ...config.sections, [id]: !config.sections[id] },
    });
  };

  const toggleWaiter = (name) => {
    const sel = new Set(config.selectedWaiters || []);
    if (sel.has(name)) sel.delete(name);
    else sel.add(name);
    set({ selectedWaiters: [...sel], allWaiters: false });
  };

  const selectedFocus = config.weeklyFocusItems || [];

  const filteredFocusCatalog = useMemo(() => {
    const q = focusSearch.trim().toLowerCase();
    const base = focusCatalog.length ? focusCatalog : DEFAULT_WEEKLY_FOCUS_ITEMS.map((label) => ({ id: label, label }));
    if (!q) return base;
    return base.filter((item) => item.label.toLowerCase().includes(q));
  }, [focusCatalog, focusSearch]);

  const toggleFocusItem = (label) => {
    const sel = new Set(selectedFocus);
    if (sel.has(label)) sel.delete(label);
    else sel.add(label);
    set({ weeklyFocusItems: [...sel] });
  };

  const selectAllFocusDefaults = () => {
    set({ weeklyFocusItems: [...DEFAULT_WEEKLY_FOCUS_ITEMS] });
  };

  const clearFocusItems = () => {
    set({ weeklyFocusItems: [] });
  };

  return (
    <motion.section
      className="vi-export-config nac-glass-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <header className="vi-export-config-head">
        <Settings2 size={18} color="#d7bc8a" />
        <div>
          <h3>Export configuration</h3>
          <p>Target date range, branch, waiters, sections, and report mode before generating PDF / XLSX</p>
        </div>
      </header>

      <div className="vi-export-config-grid">
        <div className="vi-export-block">
          <h4>Date range</h4>
          <div className="vi-export-row">
            <label>
              From
              <input type="date" value={config.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
            </label>
            <label>
              To
              <input type="date" value={config.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
            </label>
          </div>
        </div>

        <div className="vi-export-block">
          <h4>Branch</h4>
          <select value={config.branch} onChange={(e) => set({ branch: e.target.value })}>
            <option value="all">All branches</option>
            {BRANCH_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>

        <div className="vi-export-block vi-export-block--wide">
          <h4>Target mode</h4>
          <div className="vi-mode-pills">
            {Object.values(EXPORT_TARGET_MODES).map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`vi-mode-pill ${config.targetMode === mode.id ? "active" : ""}`}
                onClick={() => onChange(applyTargetMode(config, mode.id))}
                title={mode.description}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div className="vi-export-block vi-export-block--wide">
          <h4>Included sections</h4>
          <div className="vi-section-checks">
            {Object.values(EXPORT_SECTIONS).map((s) => (
              <label key={s.id} className="vi-check">
                <input
                  type="checkbox"
                  checked={Boolean(config.sections?.[s.id])}
                  onChange={() => toggleSection(s.id)}
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>

        <div className="vi-export-block">
          <h4>Waiter sort</h4>
          <select value={config.waiterSort} onChange={(e) => set({ waiterSort: e.target.value })}>
            {WAITER_SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="vi-export-block">
          <h4>Product sort</h4>
          <select value={config.productSort} onChange={(e) => set({ productSort: e.target.value })}>
            {PRODUCT_SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="vi-export-block vi-export-block--wide">
          <h4>Weekly focus items</h4>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.7rem", color: "rgba(249,249,247,0.45)" }}>
            Choose what staff should push this week — targets and exports use these items
          </p>
          <div className="vi-export-row" style={{ marginBottom: "0.5rem", gap: "0.5rem", display: "flex" }}>
            <button type="button" className="vi-mode-pill" onClick={selectAllFocusDefaults}>
              Load defaults
            </button>
            <button type="button" className="vi-mode-pill" onClick={clearFocusItems}>
              Clear
            </button>
          </div>
          <input
            type="search"
            className="vi-waiter-search"
            placeholder="Search products / modifiers…"
            value={focusSearch}
            onChange={(e) => setFocusSearch(e.target.value)}
          />
          <div className="vi-waiter-checks vi-focus-checks">
            {filteredFocusCatalog.slice(0, 40).map((item) => (
              <label key={item.id || item.label} className="vi-check">
                <input
                  type="checkbox"
                  checked={selectedFocus.includes(item.label)}
                  onChange={() => toggleFocusItem(item.label)}
                />
                {item.label}
                {item.isModifier ? " (mod)" : ""}
              </label>
            ))}
          </div>
          {selectedFocus.length > 0 && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.72rem", color: "rgba(215,188,138,0.85)" }}>
              Selected: {selectedFocus.join(" · ")}
            </p>
          )}
        </div>

        <div className="vi-export-block vi-export-block--wide">
          <h4>Staff scope</h4>
          <label className="vi-check" style={{ marginBottom: "0.5rem" }}>
            <input
              type="checkbox"
              checked={Boolean(config.includeManagers)}
              onChange={(e) => set({ includeManagers: e.target.checked })}
            />
            Include managers in analytics
          </label>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.7rem", color: "rgba(249,249,247,0.4)" }}>
            Default off — Raffi, Fady, Bashar excluded from waiter rankings & targets
          </p>
          <label className="vi-check" style={{ marginBottom: "0.5rem" }}>
            <input
              type="checkbox"
              checked={config.allWaiters}
              onChange={(e) => set({ allWaiters: e.target.checked })}
            />
            All waiters
          </label>
          {!config.allWaiters && (
            <>
              <input
                type="search"
                className="vi-waiter-search"
                placeholder="Search waiter by name…"
                value={config.waiterSearch || ""}
                onChange={(e) => set({ waiterSearch: e.target.value })}
              />
              <div className="vi-waiter-checks">
                {filteredWaiters.length === 0 ? (
                  <p className="nac-empty-state" style={{ fontSize: "0.75rem" }}>
                    Upload waiter product sales import to list staff
                  </p>
                ) : (
                  filteredWaiters.map((name) => (
                    <label key={name} className="vi-check">
                      <input
                        type="checkbox"
                        checked={(config.selectedWaiters || []).includes(name)}
                        onChange={() => toggleWaiter(name)}
                      />
                      {name}
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="vi-export-actions">
        <button type="button" className="vi-export-btn" disabled={exporting} onClick={onExportPdf}>
          <FileText size={14} /> Executive PDF
        </button>
        <button type="button" className="vi-export-btn" disabled={exporting} onClick={onExportXlsx}>
          <Download size={14} /> Boardroom XLSX
        </button>
      </div>
    </motion.section>
  );
}
