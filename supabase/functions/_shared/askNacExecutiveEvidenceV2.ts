/**
 * Executive Intelligence v2 (Edge) — multi-source evidence enrichment for executive answers.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { VAULT_INTENTS } from "./askNacVaultTools.ts";
import { getVaultFacts, searchVaultDocuments } from "./askNacVaultTools.ts";
import { fetchExecutiveMemory } from "./askNacExecutiveMemory.ts";
import { createPendingSession } from "./askNacHumanInLoop.ts";

const EXECUTIVE_QUERY_INTENTS = new Set([
  VAULT_INTENTS.BUSINESS_REASONING,
  "executive_analysis",
  VAULT_INTENTS.WEEKLY_DASHBOARD,
  VAULT_INTENTS.MANAGEMENT_REPORT,
  VAULT_INTENTS.OPERATIONAL_DAY,
  VAULT_INTENTS.PROVIDE_MANUAL_INPUT,
  VAULT_INTENTS.CASH_UP,
  VAULT_INTENTS.DOCUMENT_SEARCH,
  VAULT_INTENTS.DAILY_BRIEFING,
]);

const CONFIDENCE = { HIGH: "high", MEDIUM: "medium", LOW: "low", NONE: "none" };

function isExecutiveQueryIntent(intent: string) {
  return EXECUTIVE_QUERY_INTENTS.has(intent);
}

function factsByReportType(facts: Record<string, unknown>[], reportType: string) {
  return facts.filter((f) => (f.reportType || f.report_type) === reportType);
}

function buildGatheredFromTool(tool: Record<string, unknown> | null, route: Record<string, unknown>) {
  const facts = (tool?.facts as Record<string, unknown>[]) || [];
  const matches = (tool?.matches as Record<string, unknown>[]) || [];
  return {
    structuredFacts: {
      cash_up: factsByReportType(facts, "cash_up"),
      daily_briefing: factsByReportType(facts, "daily_briefing"),
      daily_logbook: factsByReportType(facts, "daily_logbook"),
    },
    operatorMemory: (tool?.operatorMemory as Record<string, unknown>[]) || [],
    branchMemory: (tool?.branchMemory as Record<string, unknown>[]) || [],
    historicalDashboards: matches,
    manualInputs: Array.isArray(tool?.manualInputs) ? tool?.manualInputs as unknown[] : [],
    coverage: (tool?.coverage as unknown[]) || [],
    aggregation: tool?.aggregation || null,
    vaultPeriod: route.vaultPeriod,
  };
}

function stringifyDirectAnswer(directAnswer: unknown): string {
  if (directAnswer == null) return "";
  if (typeof directAnswer === "string") return directAnswer;
  if (typeof directAnswer === "number" || typeof directAnswer === "boolean") return String(directAnswer);
  if (typeof directAnswer === "object") {
    const o = directAnswer as Record<string, unknown>;
    if (typeof o.headline === "string") return o.headline;
    if (typeof o.summary === "string") return o.summary;
    if (typeof o.text === "string") return o.text;
    if (typeof o.answer === "string") return o.answer;
  }
  return "";
}

async function augmentGathered(
  supabase: SupabaseClient,
  gathered: Record<string, unknown>,
  context: Record<string, unknown>,
) {
  const branch = context.branch as string | null;
  const vaultPeriod = context.vaultPeriod as { startDate?: string; endDate?: string } | undefined;
  const base = { branch, vaultPeriod, startDate: vaultPeriod?.startDate, endDate: vaultPeriod?.endDate, profile: context.profile };
  const [briefing, logbook, memory, dashboards] = await Promise.all([
    getVaultFacts(supabase, { ...base, reportType: "daily_briefing" }).catch(() => ({ facts: [] })),
    getVaultFacts(supabase, { ...base, reportType: "daily_logbook" }).catch(() => ({ facts: [] })),
    (!(gathered.operatorMemory as unknown[])?.length)
      ? fetchExecutiveMemory(supabase, { branch: branch || undefined }).catch(() => ({ branchMemories: [], operatorMemories: [] }))
      : Promise.resolve(null),
    searchVaultDocuments(supabase, { ...base, searchTerms: "weekly dashboard", reportTypes: ["weekly_dashboard"] }).catch(() => ({ matches: [] })),
  ]);
  const sf = gathered.structuredFacts as Record<string, unknown[]>;
  if (!(sf.daily_briefing as unknown[])?.length) sf.daily_briefing = (briefing as { facts?: unknown[] }).facts || [];
  if (!(sf.daily_logbook as unknown[])?.length) sf.daily_logbook = (logbook as { facts?: unknown[] }).facts || [];
  if (memory) {
    gathered.operatorMemory = (memory as { operatorMemories?: unknown[] }).operatorMemories || [];
    gathered.branchMemory = (memory as { branchMemories?: unknown[] }).branchMemories || [];
  }
  gathered.historicalDashboards = (dashboards as { matches?: unknown[] }).matches || [];
}

function buildEvidenceMap(gathered: Record<string, unknown>, intent: string) {
  const sf = gathered.structuredFacts as Record<string, unknown[]>;
  const facts = Object.entries(sf || {}).flatMap(([type, rows]) =>
    (rows as Record<string, unknown>[]).slice(0, 8).map((f) => ({
      text: String(f.metric_key || f.metricKey || type),
      sourceType: type,
      type: "fact",
    })),
  );
  const operatorKnowledge = [
    ...((gathered.operatorMemory as Record<string, unknown>[]) || []).map((m) => ({ text: m.fact, type: "memory" })),
    ...((gathered.branchMemory as Record<string, unknown>[]) || []).map((m) => ({ text: m.fact, type: "memory" })),
  ];
  const historicalPatterns = ((gathered.historicalDashboards as Record<string, unknown>[]) || []).slice(0, 4).map((m) => ({
    text: String(m.excerpt || m.fileTitle || "dashboard"),
    type: "historical",
  }));
  const missingInformation: Array<{ label: string; fieldKey?: string }> = [];
  if (!(sf?.daily_briefing as unknown[])?.length) missingInformation.push({ label: "Daily briefing for this period" });
  const hasLogbookChunks = [
    ...((gathered.historicalDashboards as Record<string, unknown>[]) || []),
    ...(((gathered as { matches?: Record<string, unknown>[] }).matches) || []),
  ].some((row) => /logbook|daily_logbook/i.test(String(row.reportType || row.report_type || row.sourceType || "")));
  const toolMatches = ((gathered as { toolMatches?: unknown[] }).toolMatches) || [];
  if (!(sf?.daily_logbook as unknown[])?.length && !hasLogbookChunks && !toolMatches.length) {
    missingInformation.push({ label: "Daily logbook entries" });
  }
  if (!historicalPatterns.length && intent !== VAULT_INTENTS.CASH_UP) {
    missingInformation.push({ label: "Historical weekly dashboards" });
  }
  if (intent === VAULT_INTENTS.WEEKLY_DASHBOARD || intent === VAULT_INTENTS.PROVIDE_MANUAL_INPUT) {
    missingInformation.push({ label: "7Rooms covers", fieldKey: "seven_rooms_covers" });
    missingInformation.push({ label: "Reservation count", fieldKey: "reservation_count" });
    missingInformation.push({ label: "VIP events", fieldKey: "vip_events" });
  }
  return {
    facts,
    historicalPatterns,
    operatorKnowledge,
    missingInformation,
    known: [...facts, ...operatorKnowledge, ...historicalPatterns].map((x) => x.text).filter(Boolean),
    inferred: [],
  };
}

function computeComposition(gathered: Record<string, unknown>, intent = "") {
  const aggregation = gathered.aggregation as { dayCount?: number } | null;
  const isQuantitativeCashUp = intent === VAULT_INTENTS.CASH_UP && Boolean(aggregation?.dayCount);

  // Quantitative commercial answers: honest primary/supporting labels, not chunk-count percentages.
  if (isQuantitativeCashUp) {
    const composition = [
      { source: "Cash Up structured facts", sourceType: "cash_up", count: Number(aggregation?.dayCount || 1), percent: 100, role: "primary" },
    ];
    const supportCount = ((gathered.historicalDashboards as unknown[]) || []).length
      + ((gathered.operatorMemory as unknown[]) || []).length
      + ((gathered.branchMemory as unknown[]) || []).length;
    if (supportCount > 0) {
      composition.push({
        source: "Logbook / historical context",
        sourceType: "supporting_context",
        count: supportCount,
        percent: 0,
        role: "supporting",
      });
    }
    return { composition, totalHits: composition.length, qualitative: true };
  }

  const sf = gathered.structuredFacts as Record<string, unknown[]>;
  const counts: Record<string, number> = {};
  for (const [k, rows] of Object.entries(sf || {})) counts[k] = (rows as unknown[]).length;
  counts.operator_memory = ((gathered.operatorMemory as unknown[]) || []).length;
  counts.branch_memory = ((gathered.branchMemory as unknown[]) || []).length;
  counts.weekly_dashboard = ((gathered.historicalDashboards as unknown[]) || []).length;
  counts.manual_input = ((gathered.manualInputs as unknown[]) || []).length;
  if (aggregation?.dayCount) counts.cash_up = (counts.cash_up || 0) + 1;

  let total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) {
    counts.vault = 1;
    total = 1;
  }

  const labels: Record<string, string> = {
    cash_up: "cash-up",
    daily_briefing: "daily briefing",
    daily_logbook: "logbook",
    operator_memory: "operator memory",
    branch_memory: "branch memory",
    weekly_dashboard: "historical dashboards",
    manual_input: "manual input",
    vault: "vault retrieval",
  };
  const composition = Object.entries(counts)
    .filter(([, c]) => c > 0)
    .map(([k, c]) => ({ source: labels[k] || k, sourceType: k, count: c, percent: Math.round((c / total) * 100) }))
    .sort((a, b) => b.percent - a.percent);
  return { composition, totalHits: total, qualitative: false };
}

function formatEvidenceSection(map: Record<string, unknown>) {
  const fmt = (items: Array<{ text?: string; label?: string }>) =>
    items.length ? items.map((i) => `• ${i.text || i.label}`).join("\n") : "• None matched.";
  return [
    "Evidence map:",
    `Facts:\n${fmt(map.facts as Array<{ text?: string }>)}`,
    `Historical patterns:\n${fmt(map.historicalPatterns as Array<{ text?: string }>)}`,
    `Operator knowledge:\n${fmt(map.operatorKnowledge as Array<{ text?: string }>)}`,
    `Missing information:\n${fmt(map.missingInformation as Array<{ label?: string }>)}`,
  ].join("\n\n");
}

export async function applyExecutiveIntelligenceV2({
  supabase,
  route,
  tool,
  response,
  userEmail = null,
  profile = null,
  filters = null,
}: {
  supabase?: SupabaseClient | null;
  route: Record<string, unknown>;
  tool: Record<string, unknown> | null;
  response: Record<string, unknown>;
  userEmail?: string | null;
  profile?: Record<string, unknown> | null;
  filters?: Record<string, unknown> | null;
}) {
  const intent = String(route.intent || "");
  if (!isExecutiveQueryIntent(intent)) return response;

  const gathered = buildGatheredFromTool(tool, route);
  if (supabase) {
    await augmentGathered(supabase, gathered, {
      branch: (route.branchMention || filters?.branch) as string | null,
      vaultPeriod: route.vaultPeriod,
      profile,
    });
  }

  // Carry operational-review chunk matches into missing-info detection.
  (gathered as { toolMatches?: unknown[] }).toolMatches = (tool?.matches as unknown[]) || [];

  const evidenceMap = buildEvidenceMap(gathered, intent);
  const sourceComposition = computeComposition(gathered, intent);
  const missingCount = (evidenceMap.missingInformation as unknown[]).length;
  const executiveConfidence = missingCount >= 4 ? CONFIDENCE.LOW : missingCount >= 2 ? CONFIDENCE.MEDIUM : (response.confidence as string) || CONFIDENCE.MEDIUM;

  const improvement = (evidenceMap.missingInformation as Array<{ label: string }>).map((m) => m.label).slice(0, 5);
  improvement.push("Guest feedback reports");

  const compositionText = sourceComposition.qualitative
    ? `Primary: ${sourceComposition.composition.find((r) => r.role === "primary")?.source || "Cash Up structured facts"}`
      + (sourceComposition.composition.some((r) => r.role === "supporting")
        ? `\nSupporting context: ${sourceComposition.composition.filter((r) => r.role === "supporting").map((r) => r.source).join("; ")}`
        : "")
    : sourceComposition.composition.length
      ? `Answer source composition:\n${sourceComposition.composition.map((r) => `${r.percent}% ${r.source}`).join("\n")}`
      : "Answer source composition: insufficient multi-source evidence.";

  const keepEvidenceInDirectAnswer = intent !== VAULT_INTENTS.CASH_UP;

  let followUpPrompt = "";
  if (executiveConfidence === CONFIDENCE.LOW && (intent === VAULT_INTENTS.WEEKLY_DASHBOARD || missingCount >= 3)) {
    const labels = (evidenceMap.missingInformation as Array<{ label: string }>)
      .filter((m) => /7rooms|reservation|vip/i.test(m.label))
      .slice(0, 3)
      .map((m) => m.label);
    if (labels.length) {
      followUpPrompt = `I can estimate the weekly dashboard, but I am missing:\n${labels.map((l) => `• ${l}`).join("\n")}\n\nPlease provide them.`;
    }
  }

  let pendingSessionId = response.pendingSessionId as string | null;
  if (supabase && userEmail && followUpPrompt && !response.awaitingInput) {
    try {
      const session = await createPendingSession(supabase, {
        branch: String(route.branchMention || filters?.branch || ""),
        sessionType: "executive_evidence",
        missingFields: (evidenceMap.missingInformation as Array<{ label: string; fieldKey?: string }>)
          .filter((m) => m.fieldKey)
          .slice(0, 3)
          .map((m) => ({ key: m.fieldKey, label: m.label, prompt: `Please provide ${m.label}.` })),
        context: { intent, vaultPeriod: route.vaultPeriod },
        createdBy: userEmail,
      });
      pendingSessionId = session.id;
    } catch { /* non-fatal */ }
  }

  const disclosure = {
    known: (evidenceMap.known as string[]).slice(0, 6),
    inferred: [],
    missing: (evidenceMap.missingInformation as Array<{ label: string }>).map((m) => m.label),
  };

  const recommendations = [...((response.recommendations as string[]) || [])];
  if (followUpPrompt) recommendations.unshift(followUpPrompt);

  const managerFacingExtras = keepEvidenceInDirectAnswer
    ? [
      "",
      formatEvidenceSection(evidenceMap),
      disclosure.known.length || disclosure.missing.length
        ? `\nDisclosure:\n• Known: ${disclosure.known.join("; ") || "—"}\n• Missing: ${disclosure.missing.join("; ") || "—"}`
        : "",
      improvement.length ? `\nConfidence: ${executiveConfidence}\n\nAdditional information that would improve this answer:\n${improvement.map((s) => `• ${s}`).join("\n")}` : "",
      compositionText,
    ]
    : [
      // Quantitative cash-up: keep source priority label only; dump evidence into diagnostics.
      "",
      compositionText,
    ];

  return {
    ...response,
    directAnswer: [
      stringifyDirectAnswer(response.directAnswer),
      ...managerFacingExtras,
    ].filter(Boolean).join("\n"),
    confidence: executiveConfidence,
    recommendations,
    awaitingInput: Boolean(followUpPrompt && executiveConfidence === CONFIDENCE.LOW),
    pendingSessionId,
    executiveEvidence: { evidenceMap, sourceComposition: sourceComposition.composition, disclosure },
    diagnostics: {
      ...(response.diagnostics as Record<string, unknown> || {}),
      executiveIntelligenceV2: true,
      evidenceMap,
      sourceComposition: sourceComposition.composition,
      disclosure,
      answerSourceComposition: sourceComposition.composition,
      answerSourceCompositionText: compositionText,
    },
  };
}
