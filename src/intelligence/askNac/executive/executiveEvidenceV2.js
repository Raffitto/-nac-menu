/**
 * Executive Intelligence v2 — multi-source evidence, disclosure, follow-ups, and learning hooks.
 * Makes Ask NAC behave like an experienced GM, not a database.
 */

import { ASK_NAC_INTENTS } from "../intentRouter";
import { CONFIDENCE_LEVELS } from "../askNacContract";
import { getVaultFacts, getVaultCoverage, searchVaultDocuments } from "../vault/vaultQueryTools";
import { fetchExecutiveMemory } from "./executiveMemory";
import { fetchManualInputsForPeriod } from "./manualInputs";
import { createPendingSession } from "./pendingSessions";
import { EXECUTIVE_EVIDENCE_FIELD_DEFS } from "./manualInputParser";

export const EXECUTIVE_QUERY_INTENTS = Object.freeze([
  ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING,
  ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS,
  ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD,
  ASK_NAC_INTENTS.VAULT_MANAGEMENT_REPORT,
  ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY_SUMMARY,
  ASK_NAC_INTENTS.VAULT_PROVIDE_MANUAL_INPUT,
  ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
  ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH,
  ASK_NAC_INTENTS.VAULT_DAILY_BRIEFING_SUMMARY,
]);

const SOURCE_LABELS = Object.freeze({
  cash_up: "cash-up",
  daily_briefing: "daily briefing",
  daily_logbook: "logbook",
  weekly_dashboard: "historical dashboards",
  operator_memory: "operator memory",
  branch_memory: "branch memory",
  manual_input: "manual input",
  vault: "vault retrieval",
  reception_daily_report: "reception",
  ccm_reconciliation: "CCM reconciliation",
  executive_analysis: "network executive data",
});

export function isExecutiveQueryIntent(intent) {
  return EXECUTIVE_QUERY_INTENTS.includes(intent);
}

function factLine(fact, sourceType = "structured_facts") {
  const key = fact.metricKey || fact.metric_key || "metric";
  const value = fact.metricValue ?? fact.metric_value ?? fact.dimensions?.text_value;
  const period = fact.periodEnd || fact.period_end || fact.periodStart || fact.period_start || "";
  const text = value != null && value !== "" ? `${key}: ${value}` : String(fact.dimensions?.text_value || "").slice(0, 120);
  return {
    text: text || key,
    source: SOURCE_LABELS[sourceType] || sourceType,
    period,
    type: "fact",
  };
}

function memoryLine(memory) {
  return {
    text: memory.fact || memory.text,
    source: memory.source === "operator_memory" ? "operator memory" : "branch memory",
    category: memory.category || "operational",
    type: "memory",
  };
}

function dashboardLine(match) {
  return {
    text: match.excerpt || match.fileTitle || "Weekly dashboard excerpt",
    source: "historical dashboards",
    fileTitle: match.fileTitle,
    type: "historical",
  };
}

function countBySource(entries = []) {
  const counts = {};
  for (const entry of entries) {
    const key = entry.sourceType || entry.source || "other";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export async function gatherExecutiveEvidence(supabase, context = {}) {
  if (!supabase) return emptyGathered();

  const branch = context.branch || context.branchMention || context.filters?.branch || null;
  const vaultPeriod = context.vaultPeriod || context.route?.vaultPeriod || null;
  const startDate = vaultPeriod?.startDate;
  const endDate = vaultPeriod?.endDate;
  const tool = context.tool || {};
  const baseContext = {
    branch,
    branchMention: context.branchMention,
    profile: context.profile,
    filters: context.filters,
    vaultPeriod,
    startDate,
    endDate,
  };

  const [
    cashUpFacts,
    briefingFacts,
    logbookFacts,
    executiveMemory,
    coverage,
    weeklyDashboardSearch,
    manualInputs,
  ] = await Promise.all([
    tool.facts?.length && tool.aggregation
      ? Promise.resolve({ facts: tool.facts, branchLabel: tool.branchLabel })
      : getVaultFacts(supabase, { ...baseContext, reportType: "cash_up" }).catch(() => ({ facts: [] })),
    getVaultFacts(supabase, { ...baseContext, reportType: "daily_briefing" }).catch(() => ({ facts: [] })),
    getVaultFacts(supabase, { ...baseContext, reportType: "daily_logbook" }).catch(() => ({ facts: [] })),
    tool.executiveMemory?.length
      ? Promise.resolve({
        branchMemories: tool.branchMemory || [],
        operatorMemories: tool.operatorMemory || [],
        memories: tool.executiveMemory,
      })
      : fetchExecutiveMemory(supabase, { branch }).catch(() => ({ memories: [], branchMemories: [], operatorMemories: [] })),
    getVaultCoverage(supabase, baseContext).catch(() => ({ coverage: [] })),
    searchVaultDocuments(supabase, {
      ...baseContext,
      searchTerms: "weekly dashboard executive",
      reportTypes: ["weekly_dashboard"],
    }).catch(() => ({ matches: [] })),
    startDate && endDate && branch
      ? fetchManualInputsForPeriod(supabase, { branch, periodStart: startDate, periodEnd: endDate }).catch(() => ({ inputs: [] }))
      : Promise.resolve({ inputs: [] }),
  ]);

  const structuredFacts = {
    cash_up: cashUpFacts?.facts || tool.facts || [],
    daily_briefing: briefingFacts?.facts || [],
    daily_logbook: logbookFacts?.facts || [],
  };

  return {
    branch,
    branchLabel: tool.branchLabel || cashUpFacts?.branchLabel,
    vaultPeriod,
    structuredFacts,
    operatorMemory: executiveMemory.operatorMemories || [],
    branchMemory: executiveMemory.branchMemories || [],
    historicalDashboards: tool?.matches?.length
      ? tool.matches
      : weeklyDashboardSearch?.matches || [],
    manualInputs: manualInputs?.inputs || tool.manualInputs || [],
    coverage: coverage?.coverage || [],
    aggregation: tool.aggregation || null,
    previousAggregation: tool.previousAggregation || null,
  };
}

function emptyGathered() {
  return {
    structuredFacts: { cash_up: [], daily_briefing: [], daily_logbook: [] },
    operatorMemory: [],
    branchMemory: [],
    historicalDashboards: [],
    manualInputs: [],
    coverage: [],
  };
}

export function buildExecutiveEvidenceMapV2(gathered = {}, { tool = null, intent = null } = {}) {
  const facts = [];
  for (const [reportType, rows] of Object.entries(gathered.structuredFacts || {})) {
    for (const fact of rows.slice(0, 12)) {
      facts.push({ ...factLine(fact, reportType), sourceType: reportType });
    }
  }

  if (gathered.aggregation?.totalSales != null) {
    facts.unshift({
      text: `Total sales: ${Number(gathered.aggregation.totalSales).toLocaleString()} SAR (${gathered.aggregation.dayCount || 0} day(s))`,
      source: "cash-up",
      type: "fact",
      sourceType: "cash_up",
    });
  }

  const historicalPatterns = (gathered.historicalDashboards || []).slice(0, 5).map(dashboardLine);
  const operatorKnowledge = [
    ...(gathered.operatorMemory || []).map(memoryLine),
    ...(gathered.branchMemory || []).map(memoryLine),
    ...(gathered.manualInputs || []).map((input) => ({
      text: `${input.metricLabel || input.metricKey}: ${input.metricValue ?? input.metricText}`,
      source: "manual input",
      type: "memory",
      sourceType: "manual_input",
    })),
  ];

  const missingInformation = detectMissingInformation(gathered, { tool, intent });
  const known = [
    ...facts.filter((f) => f.text),
    ...operatorKnowledge.filter((m) => m.text),
    ...historicalPatterns.filter((h) => h.text),
  ];
  const inferred = (tool?.diagnostics?.rankedHypotheses || [])
    .filter((h) => h.confidence === "low" || h.source === "heuristic")
    .map((h) => ({
      text: h.hypothesis,
      source: h.source || "heuristic",
      type: "inferred",
    }));

  return {
    facts,
    historicalPatterns,
    operatorKnowledge,
    missingInformation,
    known,
    inferred,
  };
}

function detectMissingInformation(gathered, { tool, intent } = {}) {
  const missing = [];
  const coverageTypes = new Set((gathered.coverage || []).map((row) => row.reportType || row.report_type));
  const dashboardContext = intent === ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD
    || intent === ASK_NAC_INTENTS.VAULT_PROVIDE_MANUAL_INPUT;

  if (!(gathered.structuredFacts?.cash_up?.length) && !gathered.aggregation?.dayCount) {
    missing.push({ label: "Cash-up for the requested period", reason: "No structured cash-up facts uploaded." });
  }
  if (!(gathered.structuredFacts?.daily_briefing?.length)) {
    missing.push({ label: "Daily briefing for this period", reason: "No daily briefing workbooks indexed for the period." });
  }
  if (!(gathered.structuredFacts?.daily_logbook?.length)) {
    missing.push({ label: "Daily logbook entries", reason: "No logbook structured facts for the period." });
  }
  if (!(gathered.historicalDashboards?.length) && !coverageTypes.has("weekly_dashboard")) {
    missing.push({ label: "Historical weekly dashboards", reason: "No weekly dashboard files searchable in the vault." });
  }

  if (dashboardContext) {
    const manualKeys = new Set((gathered.manualInputs || []).map((i) => i.metricKey));
    for (const field of EXECUTIVE_EVIDENCE_FIELD_DEFS) {
      if (!manualKeys.has(field.key)) {
        missing.push({ label: field.label, reason: field.prompt || `Missing ${field.label}.`, fieldKey: field.key });
      }
    }
  }

  if (tool?.previousAggregation?.dayCount === 0) {
    missing.push({ label: "Comparison period cash-up", reason: "No comparison-period cash-up for trend analysis." });
  }

  return missing.slice(0, 8);
}

export function computeSourceComposition(gathered = {}, evidenceMap = {}) {
  const weighted = [];

  for (const [reportType, facts] of Object.entries(gathered.structuredFacts || {})) {
    weighted.push(...facts.map(() => ({ sourceType: reportType })));
  }
  for (let i = 0; i < (gathered.operatorMemory || []).length; i += 1) weighted.push({ sourceType: "operator_memory" });
  for (let i = 0; i < (gathered.branchMemory || []).length; i += 1) weighted.push({ sourceType: "branch_memory" });
  for (let i = 0; i < (gathered.historicalDashboards || []).length; i += 1) weighted.push({ sourceType: "weekly_dashboard" });
  for (let i = 0; i < (gathered.manualInputs || []).length; i += 1) weighted.push({ sourceType: "manual_input" });
  if (gathered.aggregation?.dayCount) weighted.push({ sourceType: "cash_up" });

  const counts = countBySource(weighted);
  let total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) {
    counts.vault = 1;
    total = 1;
  }

  const composition = Object.entries(counts)
    .map(([key, count]) => ({
      source: SOURCE_LABELS[key] || key,
      sourceType: key,
      count,
      percent: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.percent - a.percent);

  return { composition, totalHits: total, counts };
}

export function assessExecutiveConfidence({ evidenceMap, sourceComposition, baseConfidence = CONFIDENCE_LEVELS.MEDIUM }) {
  const missingCount = evidenceMap?.missingInformation?.length || 0;
  const knownCount = evidenceMap?.known?.length || 0;
  const inferredCount = evidenceMap?.inferred?.length || 0;
  const topSource = sourceComposition?.composition?.[0]?.percent || 0;

  if (knownCount >= 8 && missingCount <= 2 && inferredCount <= 1) return CONFIDENCE_LEVELS.HIGH;
  if (missingCount >= 5 || knownCount <= 1) return CONFIDENCE_LEVELS.LOW;
  if (baseConfidence === CONFIDENCE_LEVELS.NONE) return CONFIDENCE_LEVELS.LOW;
  if (missingCount >= 3 || topSource >= 90) return CONFIDENCE_LEVELS.MEDIUM;
  return baseConfidence || CONFIDENCE_LEVELS.MEDIUM;
}

export function deriveFollowUpQuestions({ evidenceMap, confidence, intent }) {
  if (confidence === CONFIDENCE_LEVELS.HIGH) return [];

  const missing = evidenceMap?.missingInformation || [];
  const fieldMissing = missing.filter((m) => m.fieldKey);
  if (!fieldMissing.length && missing.length < 3) return [];

  const labels = fieldMissing.slice(0, 3).map((m) => m.label);
  if (!labels.length) return [];

  if (intent === ASK_NAC_INTENTS.VAULT_WEEKLY_DASHBOARD || labels.some((l) => /7rooms|reservation|vip/i.test(l))) {
    return [{
      prompt: `I can estimate the weekly dashboard, but I am missing:\n${labels.map((l) => `• ${l}`).join("\n")}\n\nPlease provide them.`,
      missingFields: fieldMissing.slice(0, 3),
      sessionType: "executive_evidence",
    }];
  }

  return [{
    prompt: `To strengthen this answer, I still need:\n${labels.map((l) => `• ${l}`).join("\n")}`,
    missingFields: fieldMissing.slice(0, 3),
    sessionType: "executive_evidence",
  }];
}

export function deriveImprovementSuggestions({ evidenceMap, gathered, vaultPeriod }) {
  const suggestions = [];
  for (const item of evidenceMap?.missingInformation || []) {
    if (item.label && !suggestions.includes(item.label)) suggestions.push(item.label);
  }
  if (!(gathered.structuredFacts?.daily_briefing?.length) && vaultPeriod?.label) {
    suggestions.push(`Daily briefing for ${vaultPeriod.label}`);
  }
  if (!(gathered.historicalDashboards?.length)) {
    suggestions.push("Historical weekly dashboard workbooks");
  }
  if (!(gathered.structuredFacts?.daily_logbook?.length)) {
    suggestions.push("Daily logbook entries for the period");
  }
  suggestions.push("Guest feedback reports");
  return [...new Set(suggestions)].slice(0, 6);
}

export function buildExecutiveDisclosure(evidenceMap = {}) {
  return {
    known: (evidenceMap.known || []).slice(0, 8).map((k) => k.text).filter(Boolean),
    inferred: (evidenceMap.inferred || []).slice(0, 5).map((i) => i.text).filter(Boolean),
    missing: (evidenceMap.missingInformation || []).map((m) => m.label).filter(Boolean),
  };
}

export function formatEvidenceMapSection(evidenceMap = {}) {
  const lines = ["Evidence map:"];
  const facts = (evidenceMap.facts || []).slice(0, 6).map((f) => f.text);
  const historical = (evidenceMap.historicalPatterns || []).slice(0, 3).map((h) => h.text);
  const operator = (evidenceMap.operatorKnowledge || []).slice(0, 4).map((o) => o.text);
  const missing = (evidenceMap.missingInformation || []).slice(0, 5).map((m) => m.label);

  lines.push(`Facts:\n${facts.length ? facts.map((f) => `• ${f}`).join("\n") : "• None indexed for this period."}`);
  lines.push(`Historical patterns:\n${historical.length ? historical.map((h) => `• ${h}`).join("\n") : "• No historical dashboard patterns matched."}`);
  lines.push(`Operator knowledge:\n${operator.length ? operator.map((o) => `• ${o}`).join("\n") : "• No operator or branch memory matched."}`);
  lines.push(`Missing information:\n${missing.length ? missing.map((m) => `• ${m}`).join("\n") : "• None flagged — coverage appears sufficient."}`);
  return lines.join("\n\n");
}

export function formatImprovementSection(suggestions = [], confidence) {
  if (!suggestions.length) return "";
  return [
    "",
    `Confidence: ${confidence}`,
    "",
    "Additional information that would improve this answer:",
    ...suggestions.map((s) => `• ${s}`),
  ].join("\n");
}

export function formatSourceCompositionDiagnostics(sourceComposition = {}) {
  const lines = (sourceComposition.composition || []).map((row) => `${row.percent}% ${row.source}`);
  return {
    answerSourceComposition: sourceComposition.composition || [],
    answerSourceCompositionText: lines.length
      ? `Answer source composition:\n${lines.join("\n")}`
      : "Answer source composition: insufficient multi-source evidence.",
  };
}

function stringifyDirectAnswer(directAnswer) {
  if (directAnswer == null) return "";
  if (typeof directAnswer === "string") return directAnswer;
  if (typeof directAnswer === "number" || typeof directAnswer === "boolean") return String(directAnswer);
  if (typeof directAnswer === "object") {
    if (typeof directAnswer.headline === "string") return directAnswer.headline;
    if (typeof directAnswer.summary === "string") return directAnswer.summary;
    if (typeof directAnswer.text === "string") return directAnswer.text;
    if (typeof directAnswer.answer === "string") return directAnswer.answer;
  }
  return "";
}

function enrichExecutiveResponse(response, payload) {
  const {
    evidenceMap,
    sourceComposition,
    followUpQuestions,
    improvementSuggestions,
    disclosure,
    executiveConfidence,
    pendingSessionId,
    awaitingInput,
  } = payload;

  const compositionDiag = formatSourceCompositionDiagnostics(sourceComposition);
  const evidenceSection = formatEvidenceMapSection(evidenceMap);
  const improvementSection = formatImprovementSection(improvementSuggestions, executiveConfidence);

  const disclosureLines = [];
  if (disclosure.known?.length) disclosureLines.push(`Known: ${disclosure.known.slice(0, 4).join("; ")}`);
  if (disclosure.inferred?.length) disclosureLines.push(`Inferred (not confirmed): ${disclosure.inferred.slice(0, 3).join("; ")}`);
  if (disclosure.missing?.length) disclosureLines.push(`Missing: ${disclosure.missing.slice(0, 4).join("; ")}`);

  const followUp = followUpQuestions[0];
  const directAnswerParts = [
    stringifyDirectAnswer(response.directAnswer),
    "",
    evidenceSection,
    disclosureLines.length ? `\nDisclosure:\n${disclosureLines.map((l) => `• ${l}`).join("\n")}` : "",
    improvementSection,
    compositionDiag.answerSourceCompositionText,
  ].filter(Boolean);

  const recommendations = [...(response.recommendations || [])];
  if (followUp?.prompt && executiveConfidence !== CONFIDENCE_LEVELS.HIGH) {
    recommendations.unshift(followUp.prompt);
  }

  return {
    ...response,
    directAnswer: directAnswerParts.join("\n"),
    confidence: executiveConfidence,
    recommendations,
    awaitingInput: awaitingInput || Boolean(followUp?.prompt && executiveConfidence === CONFIDENCE_LEVELS.LOW),
    pendingSessionId: pendingSessionId || response.pendingSessionId || null,
    executiveEvidence: {
      evidenceMap,
      sourceComposition: sourceComposition.composition,
      followUpQuestions,
      improvementSuggestions,
      disclosure,
    },
    diagnostics: {
      ...(response.diagnostics || {}),
      executiveIntelligenceV2: true,
      evidenceMap,
      sourceComposition,
      disclosure,
      ...compositionDiag,
    },
    insights: [
      ...(response.insights || []),
      ...disclosureLines,
    ],
  };
}

export async function applyExecutiveIntelligenceV2({
  supabase,
  route,
  tool,
  response,
  userEmail = null,
  profile = null,
  filters = null,
} = {}) {
  if (!response || !isExecutiveQueryIntent(route?.intent)) return response;

  const gathered = supabase
    ? await gatherExecutiveEvidence(supabase, {
      route,
      tool,
      branch: route.branchMention || filters?.branch,
      branchMention: route.branchMention,
      vaultPeriod: route.vaultPeriod,
      profile,
      filters,
    })
    : emptyGathered();

  const evidenceMap = buildExecutiveEvidenceMapV2(gathered, { tool, intent: route?.intent });
  const sourceComposition = computeSourceComposition(gathered, evidenceMap);
  const executiveConfidence = assessExecutiveConfidence({
    evidenceMap,
    sourceComposition,
    baseConfidence: response.confidence,
  });
  const followUpQuestions = deriveFollowUpQuestions({
    evidenceMap,
    confidence: executiveConfidence,
    intent: route.intent,
  });
  const improvementSuggestions = deriveImprovementSuggestions({
    evidenceMap,
    gathered,
    vaultPeriod: route.vaultPeriod,
  });
  const disclosure = buildExecutiveDisclosure(evidenceMap);

  let pendingSessionId = response.pendingSessionId || null;
  let awaitingInput = response.awaitingInput || false;

  const followUp = followUpQuestions[0];
  if (
    supabase
    && userEmail
    && followUp?.missingFields?.length
    && executiveConfidence !== CONFIDENCE_LEVELS.HIGH
    && !response.awaitingInput
    && route.intent !== ASK_NAC_INTENTS.VAULT_TEACH_OPERATOR
  ) {
    try {
      const session = await createPendingSession(supabase, {
        branch: route.branchMention || filters?.branch,
        sessionType: followUp.sessionType || "executive_evidence",
        missingFields: followUp.missingFields.map((m) => ({
          key: m.fieldKey || m.key,
          label: m.label,
          prompt: m.reason || m.prompt,
        })),
        context: { intent: route.intent, periodLabel: route.vaultPeriod?.label },
        createdBy: userEmail,
      });
      pendingSessionId = session.id;
      awaitingInput = executiveConfidence === CONFIDENCE_LEVELS.LOW;
    } catch {
      // Non-fatal — answer still includes follow-up text.
    }
  }

  return enrichExecutiveResponse(response, {
    evidenceMap,
    sourceComposition,
    followUpQuestions,
    improvementSuggestions,
    disclosure,
    executiveConfidence,
    pendingSessionId,
    awaitingInput,
  });
}
