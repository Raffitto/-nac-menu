/**
 * Operational timeline — ordered observations from real metrics (synthetic clock labels).
 */

const TIME_SLOTS = ["00:00", "00:15", "00:22", "00:35", "00:48", "01:05", "01:18"];

function slot(i) {
  return TIME_SLOTS[i % TIME_SLOTS.length];
}

/**
 * @param {object} input
 */
export function buildExecutiveTimeline(input = {}) {
  const events = [];
  const networkWide = input.networkWide !== false;
  const allowed = input.allowedBranchIds?.length
    ? new Set(input.allowedBranchIds.map((id) => String(id).toLowerCase()))
    : null;
  const status = (input.branchStatus || []).filter((b) =>
    allowed ? allowed.has(String(b.branch_id).toLowerCase()) : true,
  );
  const momentum = input.momentum || {};
  const comparison = (input.branchComparison || []).filter((c) =>
    allowed ? allowed.has(String(c.branch_id).toLowerCase()) : true,
  );
  const totalGoogle = comparison.reduce((s, r) => s + (r.google_redirects || 0), 0);
  const totalScans = comparison.reduce((s, r) => s + (r.qr_scans || 0), 0);
  let idx = 0;

  status.forEach((b) => {
    if (b.momentum === "Declining" && b.qr_scans >= 8) {
      events.push({
        time: slot(idx++),
        text: `${b.branch_name} momentum slowing (${b.conversion_pct}% tap-to-Google).`,
        branch_id: b.branch_id,
        kind: "momentum",
      });
    }
    if (b.momentum === "Rising" && b.qr_scans >= 8) {
      events.push({
        time: slot(idx++),
        text: `${b.branch_name} redirect spike detected (${b.google_redirects} redirects).`,
        branch_id: b.branch_id,
        kind: "spike",
      });
    }
    if (b.participation_breadth >= 55 && b.conversion_pct < 35 && b.qr_scans >= 12) {
      events.push({
        time: slot(idx++),
        text: `${b.branch_name} participation recovery — conversion still below target.`,
        branch_id: b.branch_id,
        kind: "participation",
      });
    }
  });

  if (networkWide) {
    if (momentum.momentum === "Rising" && !momentum.insufficient_data) {
      events.push({
        time: slot(idx++),
        text: "Network review pace above weekly average.",
        kind: "network",
      });
    } else if (momentum.momentum === "Declining") {
      events.push({
        time: slot(idx++),
        text: "Network redirect pace trailing prior period.",
        kind: "network",
      });
    }
  }

  if (totalGoogle > 0 && totalScans > 0) {
    const conv = Math.round((totalGoogle / totalScans) * 100);
    const branchLabel =
      status.length === 1 ? status[0].branch_name : networkWide ? "Network" : status[0]?.branch_name || "Branch";
    events.push({
      time: slot(idx++),
      text: `${branchLabel} handoff pulse: ${totalScans} card taps, ${totalGoogle} Google redirects (${conv}% efficiency).`,
      kind: networkWide ? "pulse" : "branch_pulse",
      branch_id: status.length === 1 ? status[0].branch_id : null,
    });
  }

  const leader = [...status].sort((a, b) => (b.operational_score ?? 0) - (a.operational_score ?? 0))[0];
  if (leader?.operational_score != null) {
    events.push({
      time: slot(idx++),
      text: `${leader.branch_name} leads operational score (${leader.operational_score}).`,
      branch_id: leader.branch_id,
      kind: "leader",
    });
  }

  (input.alerts || []).slice(0, 3).forEach((a) => {
    events.push({
      time: slot(idx++),
      text: a.text.replace(/\.$/, ""),
      branch_id: a.branch_id,
      kind: "alert",
      severity: a.severity,
    });
  });

  if (!events.length) {
    return [
      {
        time: "00:00",
        text: "Insufficient live activity for timeline — expand date range or verify event capture.",
        kind: "empty",
      },
    ];
  }

  return events.slice(0, 8);
}
