/**
 * Split user-facing vs internal operator notes for BI / session analytics.
 */

const TECHNICAL_PATTERN =
  /rollup|refresh_menu_events_daily_rollup|menu_events fallback|flat counts|session_analytics|timed out|stale/i;

export function isTechnicalOpsNote(note) {
  if (!note || typeof note !== "string") return false;
  return TECHNICAL_PATTERN.test(note);
}

export function partitionBiNotes(note, { partial = false, useRollup = false } = {}) {
  if (!note) {
    return { userNote: null, opsNotes: [] };
  }

  if (!isTechnicalOpsNote(note)) {
    return { userNote: partial ? note : null, opsNotes: [] };
  }

  const opsNotes = [note.trim()];
  let userNote = null;
  if (partial) {
    userNote = useRollup
      ? "Long-range view uses daily aggregates; live detail filled where needed."
      : "Some metrics use live menu data for this period.";
  }

  return { userNote, opsNotes };
}

export function appendOpsNote(opsNotes, line) {
  if (!line) return opsNotes || [];
  const list = [...(opsNotes || [])];
  if (!list.includes(line)) list.push(line);
  return list;
}
