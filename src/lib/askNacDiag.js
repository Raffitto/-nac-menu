/**
 * Bounded Ask NAC diagnostic history. No answer text or secrets.
 * Admin/devtools: window.__NAC_ASKNAC_DIAG__
 */

const MAX_EVENTS = 24;

function store() {
  if (typeof window === "undefined") return null;
  if (!window.__NAC_ASKNAC_DIAG__) {
    window.__NAC_ASKNAC_DIAG__ = { events: [] };
  }
  return window.__NAC_ASKNAC_DIAG__;
}

export function recordAskNacDiag(event = {}) {
  const buf = store();
  if (!buf) return null;
  const timing = event.timingMs || {};
  const next = {
    at: new Date().toISOString(),
    questionClass: event.questionClass || event.intent || null,
    source: event.source || event.coverageContract?.source || null,
    requestedPeriod: event.requestedPeriod || {
      start: event.coverageContract?.requestedStart || null,
      end: event.coverageContract?.requestedEnd || null,
    },
    availablePeriod: event.availablePeriod || {
      start: event.coverageContract?.availableStart || null,
      end: event.coverageContract?.availableEnd || null,
    },
    comparisonPeriod: event.comparisonPeriod || null,
    coverageStatus: event.coverageStatus || event.coverageContract?.coverageStatus || null,
    toolMs: timing.vaultTool ?? timing.selectedTool ?? null,
    serverMs: timing.total ?? null,
    openAiMs: timing.openAiNarration ?? null,
    correctionNeeded: Boolean(event.correctionNeeded),
  };
  buf.events = [next, ...buf.events].slice(0, MAX_EVENTS);
  return next;
}

export function recentAskNacDiag() {
  return store();
}
