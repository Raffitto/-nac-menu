import React from "react";
import { motion } from "framer-motion";
import { RefreshCw, Download } from "lucide-react";
import { RANGE_OPTIONS } from "../utils/rangeState";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import FilterBar from "./FilterBar";

const LANG_OPTIONS = [
  { value: "all", label: "All languages" },
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
];

const SHIFT_OPTIONS = [
  { value: "all", label: "All shifts" },
  { value: "am", label: "Morning" },
  { value: "pm", label: "Evening" },
  { value: "late", label: "Late" },
];

const EVENT_OPTIONS = [
  { value: "all", label: "All events" },
  { value: "qr_scan", label: "QR scans" },
  { value: "item_open", label: "Item views" },
  { value: "google_redirect", label: "Google clicks" },
  { value: "category_open", label: "Categories" },
];

const DAY_OPTIONS = [
  { value: "all", label: "All days" },
  { value: "weekday", label: "Weekdays" },
  { value: "weekend", label: "Weekends" },
];

const ROLE_OPTIONS = [
  { value: "all", label: "All roles" },
  { value: "receptionist", label: "Reception" },
  { value: "waiter", label: "Waiter" },
  { value: "rm", label: "Manager" },
];

function SelectPill({ label, value, options, onChange }) {
  return (
    <label className="nac-filter-pill">
      <span className="nac-filter-pill-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Extended global filters + optional legacy overview FilterBar props.
 */
export default function GlobalFilterBar({
  variant = "extended",
  branch,
  setBranch,
  timeRange,
  setTimeRange,
  liveMode,
  setLiveMode,
  onRefresh,
  onExport,
  loading,
  showLegacyBar = false,
}) {
  const filters = usePlatformFiltersOptional();

  return (
    <motion.div className="nac-global-filters" layout>
      {showLegacyBar && setBranch && (
        <FilterBar
          branch={branch}
          setBranch={setBranch}
          timeRange={timeRange}
          setTimeRange={setTimeRange}
          liveMode={liveMode}
          setLiveMode={setLiveMode}
          onRefresh={onRefresh}
          onExport={onExport}
          loading={loading}
        />
      )}

      {variant === "extended" && filters && (
        <div className="nac-filter-row">
          <motion.div className="nac-filter-range-group">
            {RANGE_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.title}
                className={`nac-filter-range-btn ${filters.selectedRange === t.id ? "active" : ""}`}
                onClick={() => filters.setSelectedRange(t.id)}
              >
                {t.label}
              </button>
            ))}
          </motion.div>

          <SelectPill label="Branch" value={filters.branch || "all"} options={[
            { value: "all", label: "All branches" },
            { value: "khobar", label: "Khobar" },
            { value: "riyadh", label: "Riyadh" },
            { value: "jeddah", label: "Jeddah" },
          ]} onChange={(v) => filters.setBranch(v === "all" ? null : v)} />

          <SelectPill label="Language" value={filters.language} options={LANG_OPTIONS} onChange={filters.setLanguage} />
          <SelectPill label="Shift" value={filters.shift} options={SHIFT_OPTIONS} onChange={filters.setShift} />
          <SelectPill label="Event" value={filters.eventType} options={EVENT_OPTIONS} onChange={filters.setEventType} />
          <SelectPill label="Day" value={filters.dayType} options={DAY_OPTIONS} onChange={filters.setDayType} />
          <SelectPill label="Role" value={filters.role} options={ROLE_OPTIONS} onChange={filters.setRole} />

          {onRefresh && (
            <button type="button" className="nac-filter-action" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={14} className={loading ? "nac-bi-spin" : ""} />
              Refresh
            </button>
          )}
          {onExport && (
            <button type="button" className="nac-filter-action" onClick={onExport}>
              <Download size={14} />
              Export
            </button>
          )}

          <button
            type="button"
            className={`nac-filter-range-btn ${filters.liveMode ? "active" : ""}`}
            onClick={() => filters.setLiveMode(!filters.liveMode)}
            title="Auto-refresh Overview every 30 seconds"
          >
            Live
          </button>
        </div>
      )}
    </motion.div>
  );
}
