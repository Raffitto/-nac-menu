/**
 * Unified platform status — executive-safe messaging (no dev jargon in user copy).
 */

import { isTechnicalOpsNote, partitionBiNotes } from "../../lib/biOpsNotes";
import { isBiTotalsEmpty } from "../../lib/biDashboardNormalize";
import {
  PLATFORM_STATUS,
  PLATFORM_STATUS_LABELS,
} from "../contracts/platformStatusContract";

export { PLATFORM_STATUS, PLATFORM_STATUS_LABELS };

const USER_MESSAGES = {
  [PLATFORM_STATUS.HEALTHY]: null,
  [PLATFORM_STATUS.PARTIAL]:
    "This period uses a mix of live activity and daily summaries. Totals are reliable; some detail charts may be simplified.",
  [PLATFORM_STATUS.LIVE_FALLBACK]:
    "Numbers reflect live menu activity for this period. Item and session detail is included where available.",
  [PLATFORM_STATUS.BASELINE_BUILDING]:
    "We are still collecting enough activity to score this period confidently. Check back after more guest sessions.",
  [PLATFORM_STATUS.SPARSE_HISTORY]:
    "Activity is light for this period. Trends will become clearer as more guests use the menu.",
  [PLATFORM_STATUS.STALE_ROLLUP]:
    "Daily summaries are catching up. Refresh in a few minutes for the latest totals.",
  [PLATFORM_STATUS.EMPTY]:
    "No menu or review activity recorded for this branch and period yet.",
};

function noteImpliesStaleRollup(note) {
  return /rollup|stale|refresh_menu_events/i.test(String(note || ""));
}

/**
 * Resolve a single status from BI / review fetch metadata.
 */
export function resolveMenuPlatformStatus({
  data = null,
  partial = false,
  liveFallback = false,
  note = null,
  opsNotes = [],
  menuDataEmpty = false,
  scoresBuilding = false,
  selectedRange = "today",
} = {}) {
  const partitioned = partitionBiNotes(note, { partial, useRollup: selectedRange !== "today" });
  const technicalOps = [
    ...(opsNotes || []),
    ...(partitioned.opsNotes || []),
    ...(isTechnicalOpsNote(note) ? [note] : []),
  ].filter(Boolean);

  const empty = menuDataEmpty || isBiTotalsEmpty(data);
  const sessions = Number(data?.total_sessions) || 0;
  const events = Number(data?.total_events) || 0;

  let status = PLATFORM_STATUS.HEALTHY;

  if (empty && !liveFallback) {
    status = PLATFORM_STATUS.EMPTY;
  } else if (scoresBuilding) {
    status = PLATFORM_STATUS.BASELINE_BUILDING;
  } else if (liveFallback) {
    status = PLATFORM_STATUS.LIVE_FALLBACK;
  } else if (noteImpliesStaleRollup(note)) {
    status = PLATFORM_STATUS.STALE_ROLLUP;
  } else if (partial && (sessions < 8 || events < 20)) {
    status = PLATFORM_STATUS.SPARSE_HISTORY;
  } else if (partial) {
    status = PLATFORM_STATUS.PARTIAL;
  } else if (!liveFallback && sessions < 5 && events < 12) {
    status = PLATFORM_STATUS.SPARSE_HISTORY;
  }

  const userMessage =
    partitioned.userNote || USER_MESSAGES[status] || null;

  return {
    status,
    label: PLATFORM_STATUS_LABELS[status],
    userMessage,
    opsNotes: technicalOps,
    showUserBanner: Boolean(userMessage) && status !== PLATFORM_STATUS.HEALTHY,
    showOpsPanel: technicalOps.length > 0,
    confidence: statusToConfidence(status, { sessions, events }),
  };
}

export function resolveReviewPlatformStatus({
  partial = false,
  note = null,
  kpis = null,
  loading = false,
} = {}) {
  if (loading) {
    return {
      status: PLATFORM_STATUS.HEALTHY,
      label: null,
      userMessage: null,
      opsNotes: [],
      showUserBanner: false,
      showOpsPanel: false,
      confidence: "low",
    };
  }

  const scans = Number(kpis?.qr_scans) || 0;
  const opsNotes = isTechnicalOpsNote(note) ? [note] : [];
  let status = PLATFORM_STATUS.HEALTHY;

  if (partial && scans < 5) {
    status = PLATFORM_STATUS.SPARSE_HISTORY;
  } else if (partial) {
    status = PLATFORM_STATUS.PARTIAL;
  } else if (scans === 0) {
    status = PLATFORM_STATUS.EMPTY;
  }

  const userMessage = partial && !isTechnicalOpsNote(note) ? note : USER_MESSAGES[status];

  return {
    status,
    label: PLATFORM_STATUS_LABELS[status],
    userMessage: userMessage || null,
    opsNotes,
    showUserBanner: Boolean(userMessage) && status !== PLATFORM_STATUS.HEALTHY,
    showOpsPanel: opsNotes.length > 0,
    confidence: scans >= 20 ? "high" : scans >= 8 ? "medium" : "low",
  };
}

function statusToConfidence(status, { sessions, events }) {
  if (status === PLATFORM_STATUS.EMPTY || status === PLATFORM_STATUS.SPARSE_HISTORY) {
    return "low";
  }
  if (status === PLATFORM_STATUS.BASELINE_BUILDING) return "low";
  if (sessions >= 40 || events >= 120) return "high";
  if (sessions >= 12 || events >= 35) return "medium";
  return "low";
}

/** Avoid "0 guests but active staff" style UI — prefer sparse state. */
export function reconcileActivityContradiction({ sessions = 0, events = 0, staffActive = 0 }) {
  if (sessions === 0 && events === 0 && staffActive > 0) {
    return {
      suppressActivityKpis: true,
      preferStatus: PLATFORM_STATUS.SPARSE_HISTORY,
      hint: "Staff activity is recorded; guest sessions will appear as cards are used.",
    };
  }
  return { suppressActivityKpis: false, preferStatus: null, hint: null };
}
