/**
 * NIL domain registry — plug-in metadata for intelligence domains.
 * Future integrations attach via registerNilDomain() without changing the reasoning engine.
 */

import { NIL_DOMAINS, NIL_DOMAIN_LABELS } from "./nilContract.ts";

/** @typedef {Object} NilDomainDefinition
 * @property {string} id
 * @property {string} label
 * @property {string} bundleKey internalSignals|competitorSignals|...
 * @property {number} defaultReliability 0–1
 * @property {string[]} diagnosticQuestions
 * @property {boolean} [enabled]
 */

/** @type {Map<string, NilDomainDefinition>} */
const domainRegistry = new Map();

const DEFAULT_DOMAINS = [
  {
    id: NIL_DOMAINS.INTERNAL_OPERATIONAL,
    label: NIL_DOMAIN_LABELS[NIL_DOMAINS.INTERNAL_OPERATIONAL],
    bundleKey: "internalSignals",
    defaultReliability: 0.9,
    diagnosticQuestions: [
      "Did we create our own problem?",
      "Was service affected?",
      "Was execution affected?",
      "Was staffing affected?",
      "Were guests dissatisfied?",
    ],
  },
  {
    id: NIL_DOMAINS.COMPETITIVE,
    label: NIL_DOMAIN_LABELS[NIL_DOMAINS.COMPETITIVE],
    bundleKey: "competitorSignals",
    defaultReliability: 0.55,
    diagnosticQuestions: [
      "Did competitors outperform us?",
      "Did competitors run campaigns?",
      "Did competitors attract traffic away from us?",
      "Did competitors launch something new?",
    ],
  },
  {
    id: NIL_DOMAINS.WEATHER,
    label: NIL_DOMAIN_LABELS[NIL_DOMAINS.WEATHER],
    bundleKey: "weatherSignals",
    defaultReliability: 0.75,
    diagnosticQuestions: [
      "Was weather materially different?",
      "Would normal guests choose to stay home?",
      "Would terrace usage be affected?",
      "Would mall traffic likely be reduced?",
    ],
  },
  {
    id: NIL_DOMAINS.CALENDAR,
    label: NIL_DOMAIN_LABELS[NIL_DOMAINS.CALENDAR],
    bundleKey: "calendarSignals",
    defaultReliability: 0.85,
    diagnosticQuestions: [
      "Was traffic expected to increase?",
      "Was traffic expected to decrease?",
      "Did actual results differ from expected seasonal behavior?",
    ],
  },
  {
    id: NIL_DOMAINS.LOCATION,
    label: NIL_DOMAIN_LABELS[NIL_DOMAINS.LOCATION],
    bundleKey: "locationSignals",
    defaultReliability: 0.6,
    diagnosticQuestions: [
      "Was access affected?",
      "Was nearby traffic redirected?",
      "Was there an attraction drawing guests elsewhere?",
    ],
  },
  {
    id: NIL_DOMAINS.MACROECONOMIC,
    label: NIL_DOMAIN_LABELS[NIL_DOMAINS.MACROECONOMIC],
    bundleKey: "macroSignals",
    defaultReliability: 0.5,
    diagnosticQuestions: ["Was there a broader market effect?"],
  },
  {
    id: NIL_DOMAINS.BRAND_HEALTH,
    label: NIL_DOMAIN_LABELS[NIL_DOMAINS.BRAND_HEALTH],
    bundleKey: "brandSignals",
    defaultReliability: 0.7,
    diagnosticQuestions: [
      "Is guest perception improving?",
      "Is guest perception deteriorating?",
      "Which issues are growing?",
    ],
  },
  {
    id: NIL_DOMAINS.PRODUCT,
    label: NIL_DOMAIN_LABELS[NIL_DOMAINS.PRODUCT],
    bundleKey: "productSignals",
    defaultReliability: 0.85,
    diagnosticQuestions: [
      "Which products drive growth?",
      "Which products suppress growth?",
      "Which categories are weakening?",
    ],
  },
  {
    id: NIL_DOMAINS.LABOR,
    label: NIL_DOMAIN_LABELS[NIL_DOMAINS.LABOR],
    bundleKey: "laborSignals",
    defaultReliability: 0.65,
    enabled: false,
    diagnosticQuestions: [
      "Did staffing impact performance?",
      "Were labor resources aligned with demand?",
    ],
  },
];

for (const domain of DEFAULT_DOMAINS) {
  domainRegistry.set(domain.id, { enabled: domain.enabled !== false, ...domain });
}

/**
 * Register or override a NIL domain definition.
 * @param {NilDomainDefinition} definition
 */
export function registerNilDomain(definition) {
  if (!definition?.id) throw new Error("registerNilDomain requires id");
  domainRegistry.set(definition.id, {
    enabled: true,
    ...domainRegistry.get(definition.id),
    ...definition,
  });
}

export function getNilDomain(id) {
  return domainRegistry.get(id) || null;
}

export function listNilDomains({ includeDisabled = false } = {}) {
  return [...domainRegistry.values()].filter((d) => includeDisabled || d.enabled !== false);
}

export function getNilDomainByBundleKey(bundleKey) {
  return listNilDomains({ includeDisabled: true }).find((d) => d.bundleKey === bundleKey) || null;
}

export function getNilBundleKeys() {
  return listNilDomains({ includeDisabled: true }).map((d) => d.bundleKey);
}
