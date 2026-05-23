/**
 * Compare floor observations vs dashboard metrics.
 */

import {
  VALIDATION_CHECKLIST_ITEMS,
  VALIDATION_OBSERVATION_KEY,
} from "../contracts/validationChecklist";

function resolveDashboardExpected(biData, template) {
  if (!biData) return undefined;
  if (template.id === "top_dish") return Number(biData.top_items?.[0]?.opens);
  if (template.id === "peak_hour") return biData.strongest_hour;
  if (template.dashboardPath.startsWith("funnel.")) {
    const key = template.dashboardPath.slice("funnel.".length);
    return biData.funnel?.[key];
  }
  return getPath(biData, template.dashboardPath);
}

function getPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((acc, key) => {
    if (acc == null) return undefined;
    return acc[key];
  }, obj);
}

export function readValidationObservations() {
  try {
    const raw = sessionStorage.getItem(VALIDATION_OBSERVATION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeValidationObservations(observations = {}) {
  try {
    sessionStorage.setItem(
      VALIDATION_OBSERVATION_KEY,
      JSON.stringify({ ...observations, updated_at: new Date().toISOString() }),
    );
  } catch {
    /* quota */
  }
}

/** Merge observations (e.g. from window.NAC_RECORD_OBSERVATION). */
export function recordValidationObservations(partial = {}) {
  const prev = readValidationObservations();
  const next = { ...prev, ...partial };
  writeValidationObservations(next);
  return next;
}

function comparePeakHour(observed, expected) {
  const o = Number(observed);
  const e = Number(expected);
  if (!Number.isFinite(o) || !Number.isFinite(e)) {
    return { status: "pending", deltaPct: null };
  }
  const diff = Math.abs(o - e);
  const pass = diff <= 1 || diff === 23;
  return {
    status: pass ? "pass" : "warn",
    deltaPct: diff * 10,
  };
}

function compareNumeric(observed, expected, tolerancePct) {
  const o = Number(observed);
  const e = Number(expected);
  if (!Number.isFinite(o)) return { status: "pending", deltaPct: null };
  if (!Number.isFinite(e) || e === 0) {
    return {
      status: o === 0 ? "pass" : "warn",
      deltaPct: o > 0 ? 100 : 0,
    };
  }
  const deltaPct = Math.round((Math.abs(o - e) / e) * 100);
  return {
    status: deltaPct <= tolerancePct ? "pass" : "warn",
    deltaPct,
  };
}

/**
 * Run checklist against BI payload + stored observations.
 */
export function runValidationChecklist({
  biData = null,
  observations = null,
} = {}) {
  const obs = observations || readValidationObservations();

  const items = VALIDATION_CHECKLIST_ITEMS.map((template) => {
    const observed = obs[template.observationKey];
    const resolvedExpected = resolveDashboardExpected(biData, template);

    const cmp =
      template.id === "peak_hour"
        ? comparePeakHour(observed, resolvedExpected)
        : compareNumeric(observed, resolvedExpected, template.tolerancePct);

    return {
      ...template,
      observed: observed ?? null,
      expected: resolvedExpected ?? null,
      status: cmp.status,
      delta_pct: cmp.deltaPct,
    };
  });

  const scored = items.filter((i) => i.status !== "pending");
  const pass = scored.filter((i) => i.status === "pass").length;
  const alignmentPct =
    scored.length > 0 ? Math.round((pass / scored.length) * 100) : null;

  return {
    items,
    pass_count: pass,
    scored_count: scored.length,
    alignment_pct: alignmentPct,
    observations: obs,
    updated_at: obs.updated_at || null,
  };
}
