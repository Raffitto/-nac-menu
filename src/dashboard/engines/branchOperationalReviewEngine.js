/**
 * Detailed Branch Operational Review — data model for executive staff audits.
 */

import {
  aggregateStaffReviewStats,
  mergeStaffStats,
} from "../utils/staffReviewStats";
import { computeReviewKpis } from "../utils/reviewEventMetrics";
import { branchDisplayName } from "../utils/rangeState";
import { staffNameForTracking } from "../../review/reviewGeneratorShared";

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
  if (scans.length < 3) return "Insufficient scan sample";

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
  if (max === morning && morning >= scans.length * 0.45) return "Morning shift lean";
  if (max === evening && evening >= scans.length * 0.45) return "Evening shift lean";
  if (max === midday && midday >= scans.length * 0.4) return "Midday shift lean";
  return "Balanced across dayparts";
}

export function classifyBranchOperationalStaff(staff, branchStats) {
  const scans = staff.scans || 0;
  const generated = staff.generated || 0;
  const google = staff.google || 0;
  const reviewConv = generated > 0 ? pct(google, generated) : 0;

  if (scans < MIN_SAMPLE && generated < MIN_SAMPLE) {
    return {
      key: "low_sample",
      label: "Low sample size",
      tone: "neutral",
      coaching:
        "Insufficient tagged volume — extend QR coaching before performance decisions.",
    };
  }

  if (
    generated >= 5 &&
    reviewConv >= 32 &&
    scans >= branchStats.medianScans
  ) {
    return {
      key: "premium",
      label: "Premium performer",
      tone: "gold",
      coaching:
        "Protect this profile — replicate QR placement and post-review Google CTA on floor.",
    };
  }

  if (scans >= branchStats.medianScans && reviewConv < 18 && generated >= 2) {
    return {
      key: "hi_vis_low_conv",
      label: "High visibility / low conversion",
      tone: "amber",
      coaching:
        "Guests engage but stall before Google — tighten copy coaching and device handoff at table.",
    };
  }

  if (scans < branchStats.medianScans * 0.4 && generated < 2) {
    return {
      key: "underutilized",
      label: "Underutilized staff",
      tone: "critical",
      coaching:
        "Low QR activation — assign visible table touches and review script refresh.",
    };
  }

  if (generated >= 3 && reviewConv >= 28) {
    return {
      key: "consistent",
      label: "Consistent converter",
      tone: "teal",
      coaching:
        "Stable review-to-Google funnel — maintain script; test premium upsell pairing.",
    };
  }

  if (scans >= branchStats.medianScans && generated < branchStats.medianGenerated * 0.55) {
    return {
      key: "front_desk",
      label: "Front-desk opportunity",
      tone: "amber",
      coaching:
        "Strong scan traffic with weak generation — coach opening line before guest sits.",
    };
  }

  if (generated >= 2 && reviewConv < 15) {
    return {
      key: "coaching",
      label: "Needs coaching",
      tone: "critical",
      coaching:
        "Reviews generate but Google handoff fails — role-play copy + one-tap redirect.",
    };
  }

  return {
    key: "consistent",
    label: "Consistent converter",
    tone: "teal",
    coaching: "Monitor weekly — reinforce behaviors that sustain review completion.",
  };
}

function operationalArchetype(classification) {
  const map = {
    premium: "Revenue amplifier",
    hi_vis_low_conv: "Visibility trap",
    underutilized: "Dormant touchpoint",
    consistent: "Steady closer",
    front_desk: "Host conversion gap",
    coaching: "Script gap",
    low_sample: "Early signal",
  };
  return map[classification.key] || "Floor contributor";
}

function enrichStaffRow(staff, events, branchStats) {
  const scans = staff.scans || 0;
  const generated = staff.generated || 0;
  const google = staff.google || 0;
  const reviewConv = generated > 0 ? pct(google, generated) : staff.conversion_pct || 0;
  const visibilityEfficiency = scans > 0 ? pct(generated, scans) : 0;
  const classification = classifyBranchOperationalStaff(staff, branchStats);

  return {
    name: staff.name,
    role: staff.role || "—",
    scans,
    generated,
    google,
    copy: staff.copy || 0,
    reviewConv,
    visibilityEfficiency,
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
    strongestPerformer: strongest?.name
      ? `${strongest.name} (${strongest.google} Google · ${strongest.reviewConv}% conv)`
      : "—",
    weakestConversion: weakestConv?.name
      ? `${weakestConv.name} (${weakestConv.reviewConv}% review→Google)`
      : "—",
    bestVisibility: bestVisibility?.name
      ? `${bestVisibility.name} (${bestVisibility.scans} QR scans)`
      : "—",
    hiddenOpportunity: hiddenOpp?.name
      ? `${hiddenOpp.name} — ${hiddenOpp.scans} scans, ${hiddenOpp.reviewConv}% conv`
      : "No major gap flagged",
    estimatedRecoverableReviews: recoverable,
    staffCount: staffRows.length,
    branchConversion: branchConv,
  };
}

export function buildBranchOperationalReport(allEvents, branchId) {
  const id = (branchId || "").toLowerCase();
  const branchEvents = (allEvents || []).filter(
    (e) => (e.branch_id || "").toLowerCase() === id,
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
