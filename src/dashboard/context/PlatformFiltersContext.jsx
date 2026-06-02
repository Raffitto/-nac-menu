import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_RANGE, hoursToRange, rangeToHours } from "../utils/rangeState";

const STORAGE_KEY = "nac_platform_filters_v1";

const DEFAULTS = {
  branch: null,
  selectedRange: DEFAULT_RANGE,
  timeRangeHours: 24,
  language: "all",
  shift: "all",
  eventType: "all",
  dayType: "all",
  role: "all",
};

const PlatformFiltersContext = createContext(null);

function loadStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function reconcileStoredHours(stored = {}) {
  const range = stored.selectedRange ?? DEFAULTS.selectedRange;
  const expected = rangeToHours(range);
  const storedHours = Number(stored.timeRangeHours);
  if (!Number.isFinite(storedHours) || hoursToRange(storedHours) !== range) {
    return expected;
  }
  return storedHours;
}

export function PlatformFiltersProvider({ children }) {
  const stored = useMemo(() => loadStored(), []);

  const initialRange = stored.selectedRange ?? DEFAULTS.selectedRange;
  const initialHours = reconcileStoredHours(stored);

  const [branch, setBranch] = useState(stored.branch ?? DEFAULTS.branch);
  const [selectedRange, setSelectedRange] = useState(initialRange);
  const [timeRangeHours, setTimeRangeHours] = useState(initialHours);
  const [language, setLanguage] = useState(stored.language ?? DEFAULTS.language);
  const [shift, setShift] = useState(stored.shift ?? DEFAULTS.shift);
  const [eventType, setEventType] = useState(stored.eventType ?? DEFAULTS.eventType);
  const [dayType, setDayType] = useState(stored.dayType ?? DEFAULTS.dayType);
  const [role, setRole] = useState(stored.role ?? DEFAULTS.role);
  const [liveMode, setLiveMode] = useState(Boolean(stored.liveMode));

  useEffect(() => {
    if (initialHours === rangeToHours(initialRange)) return;
    try {
      const next = { ...stored, selectedRange: initialRange, timeRangeHours: initialHours };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time storage reconcile on mount
  }, []);

  const setSelectedRangeSync = useCallback((range) => {
    setSelectedRange(range);
    setTimeRangeHours(rangeToHours(range));
  }, []);

  const setTimeRangeHoursSync = useCallback((hours) => {
    setTimeRangeHours(hours);
    setSelectedRange(hoursToRange(hours));
  }, []);

  const persist = useCallback(
    (patch) => {
      try {
        const next = {
          branch,
          selectedRange,
          timeRangeHours,
          language,
          shift,
          eventType,
          dayType,
          role,
          liveMode,
          ...patch,
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [branch, selectedRange, timeRangeHours, language, shift, eventType, dayType, role, liveMode],
  );

  const filterKey = useMemo(
    () =>
      [
        branch,
        selectedRange,
        timeRangeHours,
        language,
        shift,
        eventType,
        dayType,
        role,
      ].join("|"),
    [
      branch,
      selectedRange,
      timeRangeHours,
      language,
      shift,
      eventType,
      dayType,
      role,
    ],
  );

  const value = useMemo(
    () => ({
      filterKey,
      branch,
      setBranch: (b) => {
        setBranch(b);
        persist({ branch: b });
      },
      selectedRange,
      setSelectedRange: (r) => {
        setSelectedRangeSync(r);
        persist({ selectedRange: r, timeRangeHours: rangeToHours(r) });
      },
      timeRangeHours,
      setTimeRangeHours: (h) => {
        setTimeRangeHoursSync(h);
        persist({ timeRangeHours: h, selectedRange: hoursToRange(h) });
      },
      language,
      setLanguage: (l) => {
        setLanguage(l);
        persist({ language: l });
      },
      shift,
      setShift: (s) => {
        setShift(s);
        persist({ shift: s });
      },
      eventType,
      setEventType: (e) => {
        setEventType(e);
        persist({ eventType: e });
      },
      dayType,
      setDayType: (d) => {
        setDayType(d);
        persist({ dayType: d });
      },
      role,
      setRole: (r) => {
        setRole(r);
        persist({ role: r });
      },
      liveMode,
      setLiveMode: (m) => {
        setLiveMode(m);
        persist({ liveMode: m });
      },
    }),
    [
      filterKey,
      branch,
      selectedRange,
      timeRangeHours,
      language,
      shift,
      eventType,
      dayType,
      role,
      liveMode,
      persist,
      setSelectedRangeSync,
      setTimeRangeHoursSync,
    ],
  );

  return (
    <PlatformFiltersContext.Provider value={value}>{children}</PlatformFiltersContext.Provider>
  );
}

export function usePlatformFilters() {
  const ctx = useContext(PlatformFiltersContext);
  if (!ctx) throw new Error("usePlatformFilters must be used within PlatformFiltersProvider");
  return ctx;
}

export function usePlatformFiltersOptional() {
  return useContext(PlatformFiltersContext);
}
