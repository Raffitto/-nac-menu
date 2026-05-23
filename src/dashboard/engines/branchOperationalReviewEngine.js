/**
 * Detailed Branch Operational Review — data model for executive staff audits.
 */

import {
  aggregateStaffReviewStats,
  mergeStaffStats,
} from "../utils/staffReviewStats";
import { computeReviewKpis } from "../utils/reviewEventMetrics";
import {
  kpisFromReviewSummary,
  staffFromReviewSummary,
} from "../utils/reviewSummaryMap";
import { branchDisplayName } from "../utils/rangeState";
import { normalizeBranchId } from "../utils/branchIdentity";
import { staffNameForTracking } from "../../review/reviewGeneratorShared";
import { filterAnalyticsReviewEvents } from "../utils/isProductionStaff";

export const OPERATIONAL_BRANCHES = ["khobar", "riyadh", "jeddah"];

const MIN_SAMPLE = 4;

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 100);
}

function median(values) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Asia/Riyadh hour for shift inference */
function riyadhHour(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getUTCHours() + 3) % 24;
}

export function inferStaffShiftBehavior(events = [], staffName) {
  const target = staffNameForTracking(staffName) || staffName;
  const scans = (events || []).filter(
    (e) =>
      e.event_type === "qr_scan" &&
      (staffNameForTracking(e.employee_name) || e.employee_name) === target,
  );
  if (scans.length < 3) return "—";

  let morning = 0;
  let midday = 0;
  let evening = 0;
  scans.forEach((e) => {
    const h = riyadhHour(e.created_at);
    if (h == null) return;
    if (h >= 6 && h < 12) morning += 1;
    else if (h >= 12 && h < 17) midday += 1;
    else evening += 1;
  });

  const max = Math.max(morning, midday, evening);
  if (max === morning && morning >= scans.length * 0.45) return "Morning";
  if (max === evening && evening >= scans.length * 0.45) return "Evening";
  if (max === midday && midday >= scans.length * 0.4) return "Midday";
  return "Balanced";
}

export function classifyBranchOperationalStaff(staff, branchStats) {
  const scans = staff.scans || 0;
  const generated = staff.generated || 0;
  const google = staff.google || 0;
  const reviewConv = generated > 0 ? pct(google, generated) : 0;

  if (scans < MIN_SAMPLE && generated < MIN_SAMPLE) {
    return {
      key: "low_sample",
      label: "Low sample",
      tone: "neutral",
      coaching: "Present review card more often before rating.",
    };
  }

  if (generated >= 5 && reviewConv >= 32 && scans >= branchStats.medianScans) {
    return {
      key: "premium",
      label: "Top performer",
      tone: "gold",
      coaching: "Strong end-of-service handoff — replicate verbal close.",
    };
  }

  if (scans >= branchStats.medianScans && reviewConv < 18 && generated >= 2) {
    return {
      key: "hi_vis_low_conv",
      label: "High card, low Google",
      tone: "amber",
      coaching: "High card exposure — coach verbal CTA after review.",
    };
  }

  if (scans < branchStats.medianScans * 0.4 && generated < 2) {
    return {
      key: "underutilized",
      label: "Low card use",
      tone: "critical",
      coaching: "Present NFC/QR card more at bill close.",
    };
  }

  if (generated >= 3 && reviewConv >= 28) {
    return {
      key: "consistent",
      label: "Steady converter",
      tone: "teal",
      coaching: "Solid follow-through — protect this handoff habit.",
    };
  }

  if (scans >= branchStats.medianScans && generated < branchStats.medianGenerated * 0.55) {
    return {
      key: "front_desk",
      label: "Handoff gap",
      tone: "amber",
      coaching: "Use card handoff at reception before guest exits.",
    };
  }

  if (generated >= 2 && reviewConv < 15) {
    return {
      key: "coaching",
      label: "Needs coaching",
      tone: "critical",
      coaching: "Improve tap/scan-to-Google completion after review.",
    };
  }

  return {
    key: "consistent",
    label: "Steady converter",
    tone: "teal",
    coaching: "Monitor weekly; keep card presentation consistent.",
  };
}

function operationalArchetype(classification) {
  const map = {
    premium: "Handoff lead",
    hi_vis_low_conv: "Follow-through gap",
    underutilized: "Dormant",
    consistent: "Steady",
    front_desk: "Reception",
    coaching: "Redirect gap",
    low_sample: "Early",
  };
  return map[classification.key] || "Floor";
}

function enrichStaffRow(staff, events, branchStats) {
  const scans = staff.scans || 0;
  const generated = staff.generated || 0;
  const google = staff.google || 0;
  const reviewConv =
    staff.scans > 0
      ? staff.conversion_pct ?? pct(google, scans)
      : generated > 0
        ? pct(google, generated)
        : 0;
  const cardToReviewEfficiency = scans > 0 ? pct(generated, scans) : 0;
  const classification = classifyBranchOperationalStaff(staff, branchStats);

  return {
    name: staff.name,
    role: staff.role || "—",
    scans,
    generated,
    google,
    copy: staff.copy || 0,
    reviewConv,
    cardToReviewEfficiency,
    visibilityEfficiency: cardToReviewEfficiency,
    classification,
    archetype: operationalArchetype(classification),
    coaching: classification.coaching,
    shiftBehavior: inferStaffShiftBehavior(events, staff.name),
    tone: classification.tone,
    score:
      scans * 0.25 +
      generated * 0.35 +
      google * 0.4 +
      reviewConv * 0.15,
  };
}

function buildBranchSummary(staffRows, kpis) {
  const withVolume = staffRows.filter((s) => s.scans >= MIN_SAMPLE || s.generated >= 2);
  const strongest = [...staffRows].sort((a, b) => b.score - a.score)[0];
  const bestVisibility = [...staffRows].sort((a, b) => b.scans - a.scans)[0];
  const weakestConv = [...withVolume]
    .filter((s) => s.generated >= 2)
    .sort((a, b) => a.reviewConv - b.reviewConv)[0];
  const hiddenOpp = [...staffRows]
    .filter((s) => s.scans >= 8 && s.reviewConv < 20)
    .sort((a, b) => b.scans - a.scans)[0];

  const branchConv = kpis?.conversion_pct ?? 0;
  const recoverable = staffRows.reduce((sum, s) => {
    if (s.scans < 4) return sum;
    const gap = Math.max(0, s.scans - s.google);
    const target = Math.max(branchConv, 22) / 100;
    return sum + Math.round(gap * target);
  }, 0);

  return {
    strongestName: strongest?.name || "—",
    strongestValue: strongest ? `${strongest.google} redirects` : "—",
    weakestName: weakestConv?.name || "—",
    weakestValue: weakestConv ? `${weakestConv.reviewConv}%` : "—",
    bestVisName: bestVisibility?.name || "—",
    bestVisValue: bestVisibility ? `${bestVisibility.scans} presentations` : "—",
    hiddenName: hiddenOpp?.name || "None flagged",
    hiddenValue: hiddenOpp
      ? `${hiddenOpp.scans} cards · ${hiddenOpp.reviewConv}% Google`
      : "—",
    estimatedRecoverableReviews: recoverable,
    staffCount: staffRows.length,
    branchConversion: branchConv,
  };
}

/** Same staff/KPI shapes as dashboard when using get_review_events_summary RPC. */
export function buildBranchOperationalReportFromSummary(summary, branchId) {
  const id = (branchId || "").toLowerCase();
  const kpis = kpisFromReviewSummary(summary) || computeReviewKpis([]);
  const staff = mergeStaffStats([], staffFromReviewSummary(summary));

  const branchStats = {
    medianScans: median(staff.map((s) => s.scans)),
    medianGenerated: median(staff.map((s) => s.generated)),
  };

  const staffRows = staff.map((s) =>
    enrichStaffRow({ ...s, branch: id }, [], branchStats),
  );
  const summaryBlock = buildBranchSummary(staffRows, kpis);

  return {
    branchId: id,
    branchLabel: branchDisplayName(id),
    kpis,
    summary: summaryBlock,
    staffRows: staffRows.sort((a, b) => b.score - a.score),
    branchStats,
  };
}

export function buildBranchOperationalReport(allEvents, branchId) {
  const id = (branchId || "").toLowerCase();
  const branchEvents = filterAnalyticsReviewEvents(allEvents).filter(
    (e) => normalizeBranchId(e.branch_id) === id,
  );
  const kpis = computeReviewKpis(branchEvents);
  const staff = mergeStaffStats([], aggregateStaffReviewStats(branchEvents, id));

  const branchStats = {
    medianScans: median(staff.map((s) => s.scans)),
    medianGenerated: median(staff.map((s) => s.generated)),
  };

  const staffRows = staff.map((s) => enrichStaffRow(s, branchEvents, branchStats));
  const summary = buildBranchSummary(staffRows, kpis);

  return {
    branchId: id,
    branchLabel: branchDisplayName(id),
    kpis,
    summary,
    staffRows: staffRows.sort((a, b) => b.score - a.score),
    branchStats,
  };
}

export function buildAllBranchOperationalReports(allEvents) {
  return OPERATIONAL_BRANCHES.map((id) =>
    buildBranchOperationalReport(allEvents, id),
  );
}
