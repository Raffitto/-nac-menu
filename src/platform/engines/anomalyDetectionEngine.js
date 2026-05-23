/**
 * Anomaly detection foundation — traffic, spikes, silence, branch inactivity.
 */

const ANOMALY = {
  TRAFFIC_DROP: "traffic_drop",
  TRAFFIC_SPIKE: "traffic_spike",
  BRANCH_INACTIVE: "branch_inactive",
  PIPELINE_SILENT: "pipeline_silent",
  TRACKING_DEGRADED: "tracking_degraded",
  POST_DEPLOY_GAP: "post_deploy_gap",
};

function severityFor(kind, magnitude) {
  if (kind === ANOMALY.PIPELINE_SILENT || kind === ANOMALY.TRACKING_DEGRADED) {
    return magnitude > 0.2 ? "high" : "medium";
  }
  if (magnitude > 2) return "high";
  if (magnitude > 1) return "medium";
  return "low";
}

/**
 * @param {object} input
 * @param {Array} [input.fetchHistory] prior BI fetches (newest first)
 * @param {object} [input.biData]
 * @param {object} [input.tracking]
 * @param {object} [input.freshness]
 * @param {string} [input.buildId]
 */
export function detectAnomalies(input = {}) {
  const anomalies = [];
  const events = Number(input.biData?.total_events) || 0;
  const history = input.fetchHistory || [];

  if (history.length >= 2) {
    const prev = Number(history[1]?.totalEvents) || 0;
    const curr = Number(history[0]?.totalEvents) ?? events;
    if (prev >= 20 && curr < prev * 0.3) {
      anomalies.push({
        type: ANOMALY.TRAFFIC_DROP,
        severity: severityFor(ANOMALY.TRAFFIC_DROP, prev / Math.max(curr, 1)),
        message: `Event volume dropped sharply (${prev} → ${curr}) vs prior fetch.`,
        prev,
        curr,
      });
    }
    if (prev >= 5 && curr > prev * 3.5) {
      anomalies.push({
        type: ANOMALY.TRAFFIC_SPIKE,
        severity: severityFor(ANOMALY.TRAFFIC_SPIKE, curr / prev),
        message: `Event volume spiked (${prev} → ${curr}) — verify tracking duplication.`,
        prev,
        curr,
      });
    }
  }

  const branchDist = input.tracking?.branch_distribution || {};
  const branchVals = Object.entries(branchDist);
  if (branchVals.length >= 2) {
    const total = branchVals.reduce((s, [, v]) => s + (Number(v) || 0), 0);
    const zeros = branchVals.filter(([, v]) => (Number(v) || 0) === 0);
    if (total >= 15 && zeros.length > 0) {
      anomalies.push({
        type: ANOMALY.BRANCH_INACTIVE,
        severity: "medium",
        message: `Branch(es) with zero tracked events while network active: ${zeros.map(([k]) => k).join(", ")}`,
        branches: zeros.map(([k]) => k),
      });
    }
  }

  const menuAgeMin = input.freshness?.last_menu_event_age_min;
  if (menuAgeMin != null && menuAgeMin > 45 && events > 0) {
    anomalies.push({
      type: ANOMALY.PIPELINE_SILENT,
      severity: "high",
      message: `No recent menu_events in DB for ${menuAgeMin}+ minutes (dashboard may show stale totals).`,
    });
  }

  const ok = Number(input.tracking?.ok) || 0;
  const fail = Number(input.tracking?.fail) || 0;
  if (ok + fail >= 5 && fail / (ok + fail) > 0.2) {
    anomalies.push({
      type: ANOMALY.TRACKING_DEGRADED,
      severity: "high",
      message: `Client insert failure rate ${Math.round((fail / (ok + fail)) * 100)}% this session.`,
    });
  }

  const lastClientTrack = input.freshness?.last_client_track;
  if (input.buildId && lastClientTrack && events === 0) {
    anomalies.push({
      type: ANOMALY.POST_DEPLOY_GAP,
      severity: "low",
      message: "Zero events in range after deploy — confirm menu tracking on production URL.",
      buildId: input.buildId,
    });
  }

  return {
    anomalies,
    hasHigh: anomalies.some((a) => a.severity === "high"),
    count: anomalies.length,
  };
}

export { ANOMALY };
