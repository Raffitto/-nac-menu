/**
 * Deterministic staff coaching observations — no external AI.
 */

import { branchDisplayName } from "../utils/rangeState";

const RECEPTION_ROLES = new Set(["reception", "receptionist", "host", "front desk", "front_desk"]);

function isReception(role = "") {
  const r = role.toLowerCase();
  return [...RECEPTION_ROLES].some((k) => r.includes(k));
}

function topStaffShare(staff = []) {
  const active = staff.filter((s) => (s.google || 0) > 0);
  const total = active.reduce((sum, s) => sum + s.google, 0);
  if (!total || !active.length) return { name: null, share: 0 };
  const top = [...active].sort((a, b) => b.google - a.google)[0];
  return { name: top.name, share: Math.round((top.google / total) * 100) };
}

/**
 * @param {object} input
 * @param {string} input.branchId
 * @param {Array} input.staff
 */
export function buildBranchStaffCoachingInsights(input = {}) {
  const branchId = (input.branchId || "").toLowerCase();
  const staff = [...(input.staff || [])].sort((a, b) => (b.google || 0) - (a.google || 0));
  const insights = [];
  const branchName = branchDisplayName(branchId);

  if (!staff.length) {
    return insights;
  }

  const { name: topName, share: topShare } = topStaffShare(staff);
  if (topName && topShare >= 45) {
    insights.push({
      type: "concentration",
      severity: topShare >= 60 ? "high" : "medium",
      branch_id: branchId,
      text: `${branchName} relies heavily on ${topName} (${topShare}% of redirects).`,
    });
  }

  if (topName && topShare >= 25 && topShare < 60) {
    insights.push({
      type: "driver",
      severity: "low",
      branch_id: branchId,
      text: `${topName} drives ${topShare}% of ${branchName} redirects.`,
    });
  }

  const inactive = staff.filter((s) => (s.scans || 0) >= 5 && (s.google || 0) === 0);
  if (inactive.length >= 2) {
    insights.push({
      type: "inactive",
      severity: "medium",
      branch_id: branchId,
      text: `${inactive.length} staff with card taps but no Google redirects at ${branchName}.`,
    });
  }

  const reception = staff.filter((s) => isReception(s.role));
  const lowReception = reception.filter((s) => (s.scans || 0) >= 4 && (s.conversion_pct || 0) < 18);
  if (lowReception.length >= 1) {
    insights.push({
      type: "reception",
      severity: "medium",
      branch_id: branchId,
      text: `Low receptionist conversion before bill-close at ${branchName}.`,
    });
  }

  const dropOff = staff.filter((s) => (s.scans || 0) >= 8 && (s.generated || 0) > 0 && (s.conversion_pct || 0) < 12);
  if (dropOff.length >= 1) {
    const names = dropOff
      .slice(0, 2)
      .map((s) => s.name)
      .join(", ");
    insights.push({
      type: "dropoff",
      severity: "medium",
      branch_id: branchId,
      text: `Conversion gap after review interaction: ${names} (${branchName}).`,
    });
  }

  const activeCount = staff.filter((s) => (s.scans || 0) >= 3).length;
  if (staff.length >= 4 && activeCount <= Math.ceil(staff.length * 0.35)) {
    insights.push({
      type: "participation",
      severity: "high",
      branch_id: branchId,
      text: `${branchName} participation concentration risk detected.`,
    });
  }

  return insights.slice(0, 6);
}

export function buildNetworkStaffCoachingInsights(staffByBranch = {}) {
  const all = [];
  Object.entries(staffByBranch).forEach(([branchId, staff]) => {
    all.push(...buildBranchStaffCoachingInsights({ branchId, staff }));
  });
  return all.slice(0, 12);
}
