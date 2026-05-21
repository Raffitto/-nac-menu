import React, { useState, useEffect } from "react";
import { Calendar, X } from "lucide-react";
import {
  EXPORT_RANGE_PRESETS,
  dashboardRangeToExportPreset,
  resolveExportRange,
  todayRiyadhDateKey,
} from "../utils/exportRangeState";

/**
 * Date range picker shown before PDF/XLSX exports.
 * Default preset matches the current dashboard filter.
 */
export default function ExportRangeModal({
  open,
  title = "Export date range",
  subtitle,
  dashboardRange = "today",
  onConfirm,
  onCancel,
}) {
  const defaultPreset = dashboardRangeToExportPreset(dashboardRange);
  const [preset, setPreset] = useState(defaultPreset);
  const [startDate, setStartDate] = useState(todayRiyadhDateKey());
  const [endDate, setEndDate] = useState(todayRiyadhDateKey());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPreset(dashboardRangeToExportPreset(dashboardRange));
    setStartDate(todayRiyadhDateKey());
    setEndDate(todayRiyadhDateKey());
    setError("");
  }, [open, dashboardRange]);

  if (!open) return null;

  const resolved = resolveExportRange({
    preset,
    startDate: preset === "custom" ? startDate : undefined,
    endDate: preset === "custom" ? endDate : undefined,
    dashboardRange,
  });

  const handleConfirm = () => {
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
    onConfirm?.(
      resolveExportRange({
        preset,
        startDate: preset === "custom" ? startDate : undefined,
        endDate: preset === "custom" ? endDate : undefined,
        dashboardRange,
      }),
    );
  };

  return (
    <div className="rev-export-modal-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="rev-export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rev-export-modal-head">
          <div>
            <h3 className="rev-export-modal-title">
              <Calendar size={16} />
              {title}
            </h3>
            {subtitle ? <p className="rev-export-modal-sub">{subtitle}</p> : null}
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
                name="export-range"
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
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
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

        <p className="rev-export-modal-preview">
          Period: <strong>{resolved.periodLabel}</strong>
        </p>
        {error ? <p className="rev-export-modal-error">{error}</p> : null}

        <div className="rev-export-modal-actions">
          <button type="button" className="rev-export-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="rev-export-btn rev-export-btn--audit" onClick={handleConfirm}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
