import React, { useEffect, useMemo, useState } from "react";
import { Calendar, X, FileDown, Search } from "lucide-react";
import {
  dashboardRangeToExportPreset,
  resolveExportRange,
  todayRiyadhDateKey,
} from "../utils/exportRangeState";
import { BRANCH_OPTIONS } from "../config/foodicsImportTypes";
import { UPSELL_GROUP_MODES } from "../engines/executiveExport/upsellGroups";

const EXPORT_RANGE_PRESETS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "month", label: "Month-to-date" },
  { id: "custom", label: "Custom range" },
];

/**
 * Unified executive export — date range, branch, upsell multi-select, PDF generate.
 */
export default function ExecutiveExportModal({
  open,
  onCancel,
  onGenerate,
  busy = false,
  dashboardRange = "7d",
  catalogItems = [],
  catalogLoading = false,
  defaultBranch = "khobar",
  onBranchChange,
  branchOptions = BRANCH_OPTIONS,
}) {
  const [preset, setPreset] = useState("7d");
  const [startDate, setStartDate] = useState(todayRiyadhDateKey());
  const [endDate, setEndDate] = useState(todayRiyadhDateKey());
  const [branch, setBranch] = useState(defaultBranch);
  const [selectedUpsells, setSelectedUpsells] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [upsellQuery, setUpsellQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPreset(dashboardRangeToExportPreset(dashboardRange));
    setStartDate(todayRiyadhDateKey());
    setEndDate(todayRiyadhDateKey());
    setBranch(defaultBranch);
    setSelectedUpsells([]);
    setSelectedGroups([]);
    setUpsellQuery("");
    setError("");
  }, [open, dashboardRange, defaultBranch]);

  const filteredCatalog = useMemo(() => {
    const q = upsellQuery.trim().toLowerCase();
    const list = catalogItems || [];
    if (!q) return list;
    return list.filter((item) => item.label.toLowerCase().includes(q));
  }, [catalogItems, upsellQuery]);

  const modifierFirst = useMemo(
    () =>
      [...filteredCatalog].sort((a, b) => {
        if (a.isModifier && !b.isModifier) return -1;
        if (!a.isModifier && b.isModifier) return 1;
        return a.label.localeCompare(b.label);
      }),
    [filteredCatalog],
  );

  if (!open) return null;

  const resolved = resolveExportRange({
    preset,
    startDate: preset === "custom" ? startDate : undefined,
    endDate: preset === "custom" ? endDate : undefined,
    dashboardRange,
  });

  const toggleUpsell = (label) => {
    setSelectedUpsells((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  };

  const toggleGroup = (groupId) => {
    setSelectedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  };

  const handleGenerate = () => {
    if (preset === "custom") {
      if (!startDate || !endDate) {
        setError("Select both start and end dates.");
        return;
      }
      if (startDate > endDate) {
        setError("Start date must be on or before end date.");
        return;
      }
    }
    setError("");
    onGenerate?.({
      exportRange: resolveExportRange({
        preset,
        startDate: preset === "custom" ? startDate : undefined,
        endDate: preset === "custom" ? endDate : undefined,
        dashboardRange,
      }),
      branchId: branch,
      upsellFocusItems: selectedUpsells,
      upsellGroupIds: selectedGroups,
    });
  };

  return (
    <div className="rev-export-modal-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="rev-export-modal rev-export-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="rev-export-modal-head">
          <div>
            <h3 className="rev-export-modal-title">
              <Calendar size={16} />
              Executive Export
            </h3>
            <p className="rev-export-modal-sub">
              One PDF with top/bottom sellers, waiter rankings, upsell performance, and Khobar Google scans.
            </p>
          </div>
          <button type="button" className="rev-export-modal-close" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="rev-export-modal-presets" role="radiogroup" aria-label="Date range preset">
          {EXPORT_RANGE_PRESETS.map((opt) => (
            <label key={opt.id} className={`rev-export-preset ${preset === opt.id ? "active" : ""}`}>
              <input
                type="radio"
                name="exec-export-range"
                value={opt.id}
                checked={preset === opt.id}
                onChange={() => setPreset(opt.id)}
              />
              {opt.label}
            </label>
          ))}
        </div>

        {preset === "custom" ? (
          <div className="rev-export-modal-dates">
            <label className="rev-export-date-field">
              <span>From</span>
              <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <span className="rev-export-date-arrow">→</span>
            <label className="rev-export-date-field">
              <span>To</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={todayRiyadhDateKey()}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
        ) : null}

        <label className="rev-export-date-field exec-export-branch-field">
          <span>Branch (operational sales import)</span>
          <select
            value={branch}
            onChange={(e) => {
              setBranch(e.target.value);
              onBranchChange?.(e.target.value);
            }}
          >
            {branchOptions.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>

        <p className="rev-export-modal-preview">
          Period: <strong>{resolved.periodLabel}</strong>
        </p>

        <div className="exec-export-upsell-block">
          <h4>Upsell tracking</h4>
          <p className="rev-export-modal-sub">Operational groups + individual items for waiter upsell ranking</p>
          <div className="exec-export-group-presets">
            {UPSELL_GROUP_MODES.map((g) => (
              <label key={g.id} className={`exec-export-group-pill ${selectedGroups.includes(g.id) ? "active" : ""}`}>
                <input
                  type="checkbox"
                  checked={selectedGroups.includes(g.id)}
                  onChange={() => toggleGroup(g.id)}
                />
                {g.label}
              </label>
            ))}
          </div>
          <div className="exec-export-upsell-search">
            <Search size={14} />
            <input
              type="search"
              placeholder="Search chocolate sauce, extra shot, fresh milk…"
              value={upsellQuery}
              onChange={(e) => setUpsellQuery(e.target.value)}
            />
          </div>
          {catalogLoading ? (
            <p className="nac-empty-state">Loading catalog from latest imports…</p>
          ) : (
            <div className="exec-export-upsell-list">
              {modifierFirst.length === 0 ? (
                <p className="nac-empty-state">Upload operational sales import to populate upsell options.</p>
              ) : (
                modifierFirst.slice(0, 80).map((item) => (
                  <label key={item.id} className="exec-export-upsell-chip">
                    <input
                      type="checkbox"
                      checked={selectedUpsells.includes(item.label)}
                      onChange={() => toggleUpsell(item.label)}
                    />
                    <span>{item.label}</span>
                    {item.isModifier ? <em>modifier</em> : null}
                  </label>
                ))
              )}
            </div>
          )}
          {(selectedUpsells.length > 0 || selectedGroups.length > 0) ? (
            <p className="exec-export-selected-count">
              {selectedGroups.length} group(s) · {selectedUpsells.length} manual item(s)
            </p>
          ) : null}
        </div>

        {error ? <p className="rev-export-modal-error">{error}</p> : null}

        <div className="rev-export-modal-actions">
          <button type="button" className="rev-export-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="rev-export-btn rev-export-btn--audit"
            onClick={handleGenerate}
            disabled={busy}
          >
            <FileDown size={14} />
            {busy ? "Generating…" : "Generate PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
