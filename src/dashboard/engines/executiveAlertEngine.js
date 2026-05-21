/**
 * Rule-based executive alerts — severity: info | watch | risk | critical
 */

import { branchDisplayName } from "../utils/rangeState";

function alert(id, severity, text, branchId = null) {
  return { id, severity, text, branch_id: branchId };
}

/**
 * @param {object} input
 */
export function buildExecutiveAlerts(input = {}) {
  const comparison = input.branchComparison || [];
  const staffInsights = input.staffInsights || [];
  const momentum = input.momentum || {};
  const branchStatus = input.branchStatus || [];
  const alerts = [];

  branchStatus.forEach((b) => {
    if (b.momentum === "Rising" && b.qr_scans >= 10) {
      alerts.push(
        alert(
          `mom-up-${b.branch_id}`,
          "info",
          `${b.branch_name} momentum accelerating.`,
          b.branch_id,
        ),
      );
    }
    if (b.momentum === "Declining" && b.qr_scans >= 8) {
      alerts.push(
        alert(
          `mom-down-${b.branch_id}`,
          "watch",
          `${b.branch_name} redirect momentum slowing.`,
          b.branch_id,
        ),
      );
    }
    if (b.health?.id === "critical") {
      alerts.push(
        alert(
          `crit-${b.branch_id}`,
          "critical",
          `${b.branch_name} operational health critical (score ${b.operational_score ?? "—"}).`,
          b.branch_id,
        ),
      );
    } else if (b.health?.id === "risk") {
      alerts.push(
        alert(
          `risk-${b.branch_id}`,
          "risk",
          `${b.branch_name} requires executive attention.`,
          b.branch_id,
        ),
      );
    }
    if (b.participation_breadth < 40 && b.qr_scans >= 15) {
      alerts.push(
        alert(
          `breadth-${b.branch_id}`,
          "watch",
          `${b.branch_name} shows low participation breadth across active staff.`,
          b.branch_id,
        ),
      );
    }
  });

  staffInsights.forEach((ins, i) => {
    if (ins.type === "concentration") {
      alerts.push(
        alert(
          `conc-${ins.branch_id}-${i}`,
          ins.severity === "high" ? "risk" : "watch",
          ins.text,
          ins.branch_id,
        ),
      );
    } else if (ins.type === "reception") {
      alerts.push(
        alert(
          `recv-${ins.branch_id}-${i}`,
          "watch",
          ins.text,
          ins.branch_id,
        ),
      );
    } else if (ins.type === "inactive") {
      alerts.push(
        alert(
          `inact-${ins.branch_id}-${i}`,
          "watch",
          ins.text,
          ins.branch_id,
        ),
      );
    }
  });

  const rows = comparison.filter((c) => c.qr_scans >= 12);
  rows.forEach((row) => {
    const id = row.branch_id;
    const prev = input.previousComparison?.find((p) => p.branch_id === id);
    if (prev && prev.conversion_pct > 0) {
      const drop = Math.round(
        ((row.conversion_pct - prev.conversion_pct) / prev.conversion_pct) * 100,
      );
      if (drop <= -15) {
        alerts.push(
          alert(
            `conv-drop-${id}`,
            "risk",
            `${branchDisplayName(id)} conversion dropped ${Math.abs(drop)}% vs prior period.`,
            id,
          ),
        );
      }
    }
  });

  if (momentum.redirect_pace_vs_last_week != null && momentum.redirect_pace_vs_last_week < -12) {
    alerts.push(
      alert(
        "pace-network",
        "watch",
        `Google redirect pace below expected trend (${momentum.redirect_pace_vs_last_week}%).`,
      ),
    );
  }

  if (momentum.momentum === "Rising" && !momentum.insufficient_data) {
    alerts.push(
      alert("pace-up-network", "info", "Network review redirect momentum is rising."),
    );
  }

  const severityOrder = { critical: 0, risk: 1, watch: 2, info: 3 };
  return alerts
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
    .slice(0, 12);
}
