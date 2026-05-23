/**
 * Platform Health Score (0–100) — tracking, RPC, rollup, sufficiency, continuity, branches.
 */

export function computePlatformHealthScore({
  integrity = null,
  sufficiency = null,
  confidence = null,
  freshness = null,
  dataSource = null,
  rangeContract = null,
  anomalyReport = null,
} = {}) {
  const components = {
    tracking_integrity: 70,
    rpc_health: 70,
    rollup_freshness: 80,
    data_sufficiency: 60,
    event_continuity: 70,
    branch_coverage: 75,
  };
  const notes = [];

  const failPct = Number(integrity?.missing_event_ratio_pct) || 0;
  components.tracking_integrity = Math.max(0, 100 - failPct * 4);
  if (failPct > 10) notes.push("elevated_insert_failures");

  if (dataSource === "rpc") components.rpc_health = 92;
  else if (dataSource === "rollup") components.rpc_health = 88;
  else if (dataSource === "client_fallback") {
    components.rpc_health = 48;
    notes.push("client_fallback");
  } else {
    components.rpc_health = 35;
  }

  const rollupAge = freshness?.last_rollup_age_min;
  if (rangeContract?.isRollupRange) {
    if (rollupAge == null) {
      components.rollup_freshness = 50;
      notes.push("rollup_age_unknown");
    } else if (rollupAge > 1440) {
      components.rollup_freshness = 40;
      notes.push("rollup_stale");
    } else if (rollupAge > 360) {
      components.rollup_freshness = 65;
    } else {
      components.rollup_freshness = 90;
    }
  }

  if (sufficiency?.sufficient) components.data_sufficiency = 88;
  else if (sufficiency?.sparse) {
    components.data_sufficiency = 42;
    notes.push("sparse_history");
  } else if (sufficiency?.baselineBuilding) {
    components.data_sufficiency = 58;
  }

  const menuAge = freshness?.last_menu_event_age_min;
  if (menuAge == null) components.event_continuity = 55;
  else if (menuAge <= 15) components.event_continuity = 95;
  else if (menuAge <= 60) components.event_continuity = 78;
  else if (menuAge <= 180) components.event_continuity = 55;
  else {
    components.event_continuity = 30;
    notes.push("stale_menu_events");
  }

  if (integrity?.branch_imbalance) {
    components.branch_coverage = 45;
    notes.push("branch_imbalance");
  } else if (integrity?.branch_imbalance_ratio > 4) {
    components.branch_coverage = 60;
  } else {
    components.branch_coverage = 85;
  }

  if (anomalyReport?.hasHigh) {
    Object.keys(components).forEach((k) => {
      components[k] = Math.max(0, components[k] - 12);
    });
    notes.push("active_high_anomalies");
  }

  const weights = {
    tracking_integrity: 0.2,
    rpc_health: 0.22,
    rollup_freshness: 0.12,
    data_sufficiency: 0.18,
    event_continuity: 0.18,
    branch_coverage: 0.1,
  };

  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    score += (components[key] || 0) * weight;
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  const tier =
    score >= 82 ? "healthy" : score >= 62 ? "watch" : score >= 42 ? "degraded" : "critical";

  return {
    score,
    tier,
    components,
    notes,
    confidence_level: confidence?.level || null,
    generated_at: new Date().toISOString(),
  };
}
