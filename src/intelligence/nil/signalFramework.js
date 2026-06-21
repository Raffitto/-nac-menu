/**
 * NIL signal framework — normalize domain inputs into attributed signals.
 */

import {
  createSignal,
  EVIDENCE_LEVELS,
  NIL_DOMAINS,
} from "./nilContract";
import { getNilDomain, getNilDomainByBundleKey, listNilDomains } from "./domainRegistry";

/** @typedef {(raw: unknown, context: Object) => import("./nilContract").NilSignal|null} NilSignalAdapter */

/** @type {Map<string, NilSignalAdapter[]>} */
const domainAdapters = new Map();

/**
 * Attach a domain-specific signal adapter without modifying the reasoning engine.
 * @param {string} domainId
 * @param {NilSignalAdapter} adapter
 */
export function registerNilSignalAdapter(domainId, adapter) {
  if (!domainId || typeof adapter !== "function") return;
  const list = domainAdapters.get(domainId) || [];
  list.push(adapter);
  domainAdapters.set(domainId, list);
}

function defaultReliability(domainId, raw) {
  const domain = getNilDomain(domainId);
  const explicit = Number(raw?.reliability ?? raw?.sourceReliability);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(1, explicit));
  return domain?.defaultReliability ?? 0.5;
}

function defaultSources(raw, context = {}) {
  if (Array.isArray(raw?.sources) && raw.sources.length) return raw.sources;
  const name = raw?.source || raw?.sourceName || context.defaultSource || "Uploaded operational data";
  return [{
    name: String(name),
    detail: raw?.sourceDetail ? String(raw.sourceDetail) : "",
    reliability: defaultReliability(raw?.domain, raw),
    branch: context.branchLabel || raw?.branchLabel || "",
    period: context.periodLabel || raw?.periodLabel || "",
  }];
}

function inferDirection(value, raw) {
  if (raw?.direction) return raw.direction;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (/stable|unchanged|flat|none|no change/.test(lower)) return "stable";
    if (/up|rise|increase|higher|positive/.test(lower)) return "up";
    if (/down|decline|decrease|lower|negative/.test(lower)) return "down";
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num) < 0.5) return "stable";
  return num > 0 ? "up" : "down";
}

function inferEvidenceLevel(raw, domainId) {
  if (raw?.evidenceLevel) return raw.evidenceLevel;
  if (raw?.level) return raw.level;
  if (domainId === NIL_DOMAINS.INTERNAL_OPERATIONAL && raw?.metric) return EVIDENCE_LEVELS.FACT;
  if (raw?.observation || raw?.event) return EVIDENCE_LEVELS.CORRELATION;
  if (raw?.recommendation) return EVIDENCE_LEVELS.RECOMMENDATION;
  if (raw?.hypothesis) return EVIDENCE_LEVELS.HYPOTHESIS;
  return EVIDENCE_LEVELS.RAW;
}

/**
 * Generic adapter for plain metric/observation objects.
 * @param {unknown} raw
 * @param {Object} context
 * @returns {import("./nilContract").NilSignal|null}
 */
export function adaptGenericSignal(raw, context = {}) {
  if (!raw || typeof raw !== "object") return null;

  const domainId = raw.domain || context.domainId || NIL_DOMAINS.INTERNAL_OPERATIONAL;
  const label = raw.label
    || raw.metric
    || raw.observation
    || raw.event
    || raw.recommendation
    || raw.hypothesis
    || "";
  if (!label) return null;

  const value = raw.value ?? raw.metricValue ?? raw.observation ?? raw.event ?? raw.text ?? null;
  const evidenceLevel = inferEvidenceLevel(raw, domainId);

  return createSignal({
    id: raw.id,
    domain: domainId,
    type: raw.type || (raw.metric ? "metric" : raw.event ? "event" : "observation"),
    label: String(label),
    value,
    unit: raw.unit || "",
    direction: inferDirection(value, raw),
    periodLabel: raw.periodLabel || context.periodLabel || "",
    branchLabel: raw.branchLabel || context.branchLabel || "",
    sources: defaultSources(raw, context),
    reliability: defaultReliability(domainId, raw),
    evidenceLevel,
    supports: raw.supports || [],
    metadata: raw.metadata || {},
  });
}

for (const domain of listNilDomains({ includeDisabled: true })) {
  registerNilSignalAdapter(domain.id, adaptGenericSignal);
}

/**
 * Normalize a full signal bundle input into attributed NilSignal[].
 * @param {import("./nilContract").NilSignalBundleInput} input
 * @returns {import("./nilContract").NilSignal[]}
 */
export function normalizeSignalBundle(input = {}) {
  const context = {
    question: input.question || "",
    branchLabel: input.branchLabel || "",
    periodLabel: input.periodLabel || "",
  };
  const signals = [];

  for (const domain of listNilDomains({ includeDisabled: true })) {
    const rows = input[domain.bundleKey];
    if (!Array.isArray(rows) || !rows.length) continue;

    const adapters = domainAdapters.get(domain.id) || [adaptGenericSignal];
    for (const raw of rows) {
      for (const adapter of [...adapters].reverse()) {
        const signal = adapter({ ...raw, domain: raw.domain || domain.id }, {
          ...context,
          domainId: domain.id,
          defaultSource: domain.label,
        });
        if (signal) {
          signals.push(signal);
          break;
        }
      }
    }
  }

  return dedupeSignals(signals);
}

function dedupeSignals(signals) {
  const seen = new Set();
  return signals.filter((signal) => {
    const key = `${signal.domain}|${signal.label}|${JSON.stringify(signal.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {import("./nilContract").NilSignal[]} signals
 * @returns {Record<string, import("./nilContract").NilSignal[]>}
 */
export function groupSignalsByDomain(signals = []) {
  return signals.reduce((acc, signal) => {
    const key = signal.domain || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(signal);
    return acc;
  }, {});
}

export function getDomainForBundleKey(bundleKey) {
  return getNilDomainByBundleKey(bundleKey);
}
