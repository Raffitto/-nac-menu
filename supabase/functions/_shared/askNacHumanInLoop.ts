/**
 * Human-in-the-loop executive intelligence (Edge) — manual inputs, pending sessions, Teach NAC.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacFoodicsTools.ts";
import { assessPeriodCoverage, buildCoverageAnswerLines } from "./coverageAwareness.ts";
import { resolveAnalyticalConfidence } from "./analyticalConfidence.ts";
import { VAULT_INTENTS } from "./askNacVaultTools.ts";
import { collectWeeklyDashboardData } from "./askNacWeeklyDashboardCollector.ts";

const TEACH_PATTERNS = [
  /^teach nac:\s*(.+)$/i,
  /^remember this:\s*(.+)$/i,
  /^save as operator knowledge:\s*(.+)$/i,
];

export const WEEKLY_DASHBOARD_FIELD_DEFS = Object.freeze([
  {
    key: "seven_rooms_covers",
    label: "7Rooms covers",
    prompt: "What were 7Rooms covers for this week?",
    aliases: ["7rooms", "7 rooms", "covers", "reservation covers"],
  },
]);

export function parseTeachNacCommand(question = "") {
  const text = String(question || "").trim();
  for (const pattern of TEACH_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) {
      return { fact: match[1].trim(), command: text.split(":")[0].trim() };
    }
  }
  return null;
}

export function inferOperatorMemoryCategory(fact = "") {
  const text = String(fact).toLowerCase();
  if (/\b(humidity|weather|rain|heat|temperature)\b/.test(text)) return "weather";
  if (/\b(competitor|patio|mall|football)\b/.test(text)) return "competitive";
  if (/\b(kids|policy|after \d|not allowed)\b/.test(text)) return "policy";
  if (/\b(walk-in|traffic|demand|event|ithra|aramco)\b/.test(text)) return "demand_driver";
  return "operational";
}

export function parseManualInputAnswer(question = "", missingFields: { key?: string; metric_key?: string; label?: string; aliases?: string[] }[] = []) {
  const text = String(question || "").trim();
  if (!text) return null;

  const fields = missingFields.length ? missingFields : [...WEEKLY_DASHBOARD_FIELD_DEFS];
  const lower = text.toLowerCase();

  for (const field of fields) {
    const key = field.key || field.metric_key;
    if (key === "seven_rooms_covers") {
      const patterns = [
        /(\d+)\s*covers?\b/i,
        /\bcovers?\s*(?:were|was|:)?\s*(\d+)/i,
        /7\s*rooms?\s*(?:covers?)?\s*(?:were|was|:)?\s*(\d+)/i,
      ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        const value = Number(match?.[1] || match?.[2]);
        if (Number.isFinite(value) && value >= 0) {
          return { metricKey: "seven_rooms_covers", metricLabel: "7Rooms covers", metricValue: value, rawText: text };
        }
      }
    }
    if (field.aliases?.some((a) => lower.includes(a))) {
      const numMatch = text.match(/(\d+(?:\.\d+)?)/);
      if (numMatch) {
        return { metricKey: key, metricLabel: field.label || key, metricValue: Number(numMatch[1]), rawText: text };
      }
    }
  }

  if (/^\d+(?:\.\d+)?$/.test(text) && fields.length === 1) {
    const field = fields[0];
    return {
      metricKey: field.key || field.metric_key,
      metricLabel: field.label || field.key,
      metricValue: Number(text),
      rawText: text,
    };
  }
  return null;
}

function isTeachLike(text: string) {
  return /^(teach nac|remember this|save as operator knowledge):/i.test(text);
}

export function isLikelyManualInputAnswer(question = "", { pendingSessionId, awaitingInput }: { pendingSessionId?: string | null; awaitingInput?: boolean } = {}) {
  if (!pendingSessionId && !awaitingInput) return false;
  const text = String(question || "").trim();
  if (isTeachLike(text)) return false;
  if (/\bgenerate\b.*\bdashboard\b/i.test(text)) return false;
  return parseManualInputAnswer(text) != null || /^\d+(?:\.\d+)?$/.test(text);
}

const SESSION_SELECT = "id, branch_id, session_type, status, missing_fields, provided_inputs, context, created_by, expires_at, created_at, updated_at";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const INPUT_SELECT = "id, branch_id, report_type, metric_key, metric_label, metric_value, metric_text, period_start, period_end, period_label, provided_by";

function mapSessionRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    branchId: row.branch_id as string,
    sessionType: row.session_type as string,
    status: row.status as string,
    missingFields: (row.missing_fields as unknown[]) || [],
    providedInputs: (row.provided_inputs as Record<string, unknown>) || {},
    context: (row.context as Record<string, unknown>) || {},
    createdBy: row.created_by as string,
    expiresAt: row.expires_at as string | null,
  };
}

export async function fetchPendingSession(supabase: SupabaseClient, sessionId: string | null | undefined) {
  if (!sessionId) return null;
  const { data, error } = await supabase.from("ask_nac_pending_sessions").select(SESSION_SELECT).eq("id", sessionId).maybeSingle();
  if (error || !data) return null;
  return mapSessionRow(data as Record<string, unknown>);
}

export async function fetchActivePendingSession(
  supabase: SupabaseClient,
  { branch, createdBy, sessionType = "weekly_dashboard" }: { branch: string; createdBy: string; sessionType?: string },
) {
  const { data, error } = await supabase
    .from("ask_nac_pending_sessions")
    .select(SESSION_SELECT)
    .eq("branch_id", branch)
    .eq("session_type", sessionType)
    .eq("status", "pending")
    .eq("created_by", createdBy)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapSessionRow(data as Record<string, unknown>);
}

async function createPendingSession(
  supabase: SupabaseClient,
  { branch, sessionType = "weekly_dashboard", missingFields, context = {}, createdBy }: {
    branch: string;
    sessionType?: string;
    missingFields?: unknown[];
    context?: Record<string, unknown>;
    createdBy: string;
  },
) {
  const row = {
    branch_id: branch,
    session_type: sessionType,
    status: "pending",
    missing_fields: missingFields || [...WEEKLY_DASHBOARD_FIELD_DEFS],
    provided_inputs: {},
    context,
    created_by: createdBy,
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("ask_nac_pending_sessions").insert(row).select(SESSION_SELECT).single();
  if (error) throw new Error(error.message);
  return mapSessionRow(data as Record<string, unknown>);
}

async function updatePendingSession(
  supabase: SupabaseClient,
  sessionId: string,
  { providedInputs, missingFields, status, context }: {
    providedInputs?: Record<string, unknown>;
    missingFields?: unknown[];
    status?: string;
    context?: Record<string, unknown>;
  } = {},
) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (providedInputs != null) patch.provided_inputs = providedInputs;
  if (missingFields != null) patch.missing_fields = missingFields;
  if (status != null) patch.status = status;
  if (context != null) patch.context = context;
  const { data, error } = await supabase.from("ask_nac_pending_sessions").update(patch).eq("id", sessionId).select(SESSION_SELECT).single();
  if (error) throw new Error(error.message);
  return mapSessionRow(data as Record<string, unknown>);
}

async function upsertManualInput(
  supabase: SupabaseClient,
  {
    branch, reportType = "weekly_dashboard", metricKey, metricLabel, metricValue, periodStart, periodEnd, periodLabel, pendingSessionId, providedBy,
  }: {
    branch: string;
    reportType?: string;
    metricKey: string;
    metricLabel?: string;
    metricValue: number;
    periodStart: string;
    periodEnd: string;
    periodLabel?: string;
    pendingSessionId?: string;
    providedBy: string;
  },
) {
  const row = {
    branch_id: branch,
    report_type: reportType,
    metric_key: metricKey,
    metric_label: metricLabel || metricKey,
    metric_value: metricValue,
    metric_text: String(metricValue),
    period_start: periodStart,
    period_end: periodEnd,
    period_label: periodLabel,
    pending_session_id: pendingSessionId || null,
    provided_by: providedBy,
  };
  const { data, error } = await supabase
    .from("ask_nac_manual_inputs")
    .upsert(row, { onConflict: "branch_id,report_type,metric_key,period_start,period_end" })
    .select(INPUT_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function fetchManualInputsForPeriod(
  supabase: SupabaseClient,
  { branch, reportType = "weekly_dashboard", periodStart, periodEnd }: { branch: string; reportType?: string; periodStart: string; periodEnd: string },
) {
  const { data, error } = await supabase
    .from("ask_nac_manual_inputs")
    .select(INPUT_SELECT)
    .eq("branch_id", branch)
    .eq("report_type", reportType)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);
  if (error) return { inputs: [], sources: [], warning: error.message };
  const inputs = (data || []).map((row) => ({
    metricKey: row.metric_key,
    metricLabel: row.metric_label,
    metricValue: row.metric_value,
    metricText: row.metric_text,
    source: "manual_input",
  }));
  return { inputs, sources: [{ name: "ask_nac_manual_inputs", detail: `${inputs.length} manual value(s) for period` }] };
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function resolveWeekEndingPeriod(question = "", refDate = new Date()) {
  const q = String(question || "");
  const explicit = q.match(/week ending\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
  if (explicit) {
    const parsed = new Date(`${explicit[1]} 12:00:00 UTC`);
    if (!Number.isNaN(parsed.getTime())) {
      const endDate = parsed.toISOString().slice(0, 10);
      return { startDate: addDays(endDate, -6), endDate, periodLabel: `week ending ${endDate}`, periodType: "week_ending" };
    }
  }
  const ref = new Date(refDate);
  ref.setUTCHours(12, 0, 0, 0);
  const day = ref.getUTCDay();
  const daysSinceSunday = day === 0 ? 7 : day;
  const end = new Date(ref);
  end.setUTCDate(end.getUTCDate() - daysSinceSunday);
  const endDate = end.toISOString().slice(0, 10);
  return { startDate: addDays(endDate, -6), endDate, periodLabel: `week ending ${endDate}`, periodType: "week_ending" };
}

function buildInputsMap(manualInputs: { metricKey: string; metricValue?: number | null; metricText?: string | null }[], providedInputs: Record<string, unknown> = {}) {
  const map = { ...providedInputs };
  for (const input of manualInputs) {
    map[input.metricKey] = input.metricValue ?? input.metricText;
  }
  return map;
}

function findMissingFields(fieldDefs: { key: string }[], inputsMap: Record<string, unknown>) {
  return fieldDefs.filter((f) => {
    const val = inputsMap[f.key];
    return val == null || val === "";
  });
}

export async function runWeeklyDashboardSession(
  supabase: SupabaseClient,
  {
    branch, branchLabel, userEmail, question, period, pendingSessionId = null, manualInput = null, profile = null,
  }: {
    branch: string;
    branchLabel?: string;
    userEmail: string;
    question?: string;
    period?: ReturnType<typeof resolveWeekEndingPeriod>;
    pendingSessionId?: string | null;
    manualInput?: { metricKey: string; metricLabel?: string; metricValue: number } | null;
    profile?: Record<string, unknown> | null;
  },
) {
  const vaultPeriod = period || resolveWeekEndingPeriod(question || "");
  const fieldDefs = [...WEEKLY_DASHBOARD_FIELD_DEFS];

  let session = pendingSessionId ? await fetchPendingSession(supabase, pendingSessionId) : null;
  if (!session || session.status !== "pending") {
    session = await fetchActivePendingSession(supabase, { branch, createdBy: userEmail, sessionType: "weekly_dashboard" });
  }
  if (!session || session.status !== "pending") {
    session = await createPendingSession(supabase, {
      branch,
      sessionType: "weekly_dashboard",
      missingFields: fieldDefs,
      context: { vaultPeriod, branchLabel },
      createdBy: userEmail,
    });
  }

  const manualForPeriod = await fetchManualInputsForPeriod(supabase, {
    branch,
    periodStart: vaultPeriod.startDate,
    periodEnd: vaultPeriod.endDate,
  });

  let inputsMap = buildInputsMap(manualForPeriod.inputs, session.providedInputs);

  if (manualInput?.metricKey) {
    await upsertManualInput(supabase, {
      branch,
      metricKey: manualInput.metricKey,
      metricLabel: manualInput.metricLabel,
      metricValue: manualInput.metricValue,
      periodStart: vaultPeriod.startDate,
      periodEnd: vaultPeriod.endDate,
      periodLabel: vaultPeriod.periodLabel,
      pendingSessionId: session.id,
      providedBy: userEmail,
    });
    inputsMap = { ...inputsMap, [manualInput.metricKey]: manualInput.metricValue };
    session = await updatePendingSession(supabase, session.id, { providedInputs: inputsMap });
  }

  const missing = findMissingFields(fieldDefs, inputsMap);

  if (missing.length > 0) {
    const nextField = missing[0] as { key: string; label: string; prompt?: string };
    return {
      status: "pending",
      awaitingInput: true,
      pendingSession: session,
      missingFields: missing,
      promptField: nextField,
      vaultPeriod,
      branch,
      branchLabel: branchLabel || branchDisplayName(branch),
      sources: [{ name: "ask_nac_pending_sessions", detail: "weekly dashboard awaiting manual input" }],
    };
  }

  let dashboardPackage = null;
  try {
    dashboardPackage = await collectWeeklyDashboardData(supabase, {
      branch,
      branchLabel: branchLabel || branchDisplayName(branch),
      vaultPeriod,
      manualInputs: inputsMap,
      profile,
    });
  } catch {
    dashboardPackage = null;
  }

  const aggregation = (dashboardPackage?.weekAggregation as Record<string, unknown>) || { dayCount: 0 };
  const coverageAssessment = dashboardPackage?.coverageAssessment
    || assessPeriodCoverage({ requestedPeriod: vaultPeriod, aggregation });
  const confidenceResult = dashboardPackage?.confidenceResult
    || resolveAnalyticalConfidence(coverageAssessment);

  await updatePendingSession(supabase, session.id, {
    status: "complete",
    providedInputs: inputsMap,
    missingFields: [],
    context: { vaultPeriod, branchLabel, completedAt: new Date().toISOString() },
  });

  return {
    status: "complete",
    awaitingInput: false,
    pendingSession: { ...session, status: "complete" },
    vaultPeriod,
    aggregation,
    manualInputs: inputsMap,
    coverageAssessment,
    confidenceResult,
    weeklyDashboardPackage: dashboardPackage,
    branch,
    branchLabel: branchLabel || branchDisplayName(branch),
    sources: [
      ...((dashboardPackage?.sources as { name: string; detail: string }[]) || []),
      { name: "ask_nac_pending_sessions", detail: "weekly dashboard session complete" },
    ],
  };
}

export function buildWeeklyDashboardAnswerLines(result: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const vaultPeriod = result.vaultPeriod as { periodLabel?: string } | undefined;
  const aggregation = result.aggregation as Record<string, unknown> | undefined;
  const manualInputs = result.manualInputs as Record<string, unknown> | undefined;
  const branchLabel = result.branchLabel as string | undefined;
  const coverageAssessment = result.coverageAssessment;
  const covers = manualInputs?.seven_rooms_covers;

  lines.push(`Weekly dashboard · ${branchLabel} · ${vaultPeriod?.periodLabel || "selected week"}`);
  lines.push("");
  if (aggregation?.totalSales != null) {
    lines.push(`Sales: ${Number(aggregation.totalSales).toLocaleString()} SAR (${aggregation.dayCount || 0} cash-up day(s)).`);
  }
  if (aggregation?.totalGuests != null) {
    lines.push(`Guests (cash-up): ${Number(aggregation.totalGuests).toLocaleString()}.`);
  }
  if (aggregation?.averageSpend != null) {
    lines.push(`Average spend: ${Number(aggregation.averageSpend).toFixed(2)} SAR.`);
  }
  if (covers != null) lines.push(`7Rooms covers: ${covers} (manual input · this period only).`);
  if (aggregation?.totalDeliverySales != null) {
    lines.push(`Delivery sales: ${Number(aggregation.totalDeliverySales).toLocaleString()} SAR.`);
  }
  lines.push("");
  lines.push("Executive summary");
  if (Number(aggregation?.dayCount) > 0) {
    lines.push(`Operations uploaded ${aggregation?.dayCount} cash-up day(s) for this week.`);
  } else {
    lines.push("Limited vault coverage for this week — treat sales sections as provisional.");
  }
  if (covers != null) {
    lines.push(`Reservation covers (${covers}) were provided manually for this reporting period.`);
  }
  if (coverageAssessment) {
    lines.push("");
    lines.push(...buildCoverageAnswerLines(coverageAssessment));
  }
  return lines;
}

function normalizeBranch(value: unknown): string | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "brand" || raw === "network") return null;
  if (raw.includes("khobar")) return "khobar";
  if (raw.includes("riyadh")) return "riyadh";
  if (raw.includes("jeddah") || raw.includes("jedda")) return "jeddah";
  return raw;
}

function resolveBranch(context: Record<string, unknown> = {}): string | null {
  const profile = context.profile as { branchScope?: string; allBranches?: boolean; email?: string } | undefined;
  const filters = context.filters as { branch?: string } | undefined;
  if (profile?.branchScope && !profile.allBranches) return normalizeBranch(profile.branchScope);
  return normalizeBranch(context.branchMention || filters?.branch || context.branch);
}

function resolveUserEmail(context: Record<string, unknown> = {}): string | null {
  const profile = context.profile as { email?: string } | undefined;
  const session = context.session as { user?: { email?: string } } | undefined;
  return String(context.userEmail || profile?.email || session?.user?.email || "").trim().toLowerCase() || null;
}

export async function storeOperatorMemory(
  supabase: SupabaseClient,
  { branch, fact, category, taughtBy }: { branch?: string | null; fact: string; category?: string; taughtBy: string },
) {
  const row = {
    branch_id: branch || null,
    category: category || inferOperatorMemoryCategory(fact),
    fact: fact.trim(),
    taught_by: taughtBy,
    active: true,
  };
  const { data, error } = await supabase
    .from("ask_nac_operator_memory")
    .insert(row)
    .select("id, branch_id, category, fact, taught_by, created_at")
    .single();
  if (error) throw new Error(error.message);
  return {
    memory: {
      id: data.id,
      branchId: data.branch_id,
      category: data.category,
      fact: data.fact,
      taughtBy: data.taught_by,
      source: "operator_memory",
    },
    sources: [{ name: "ask_nac_operator_memory", detail: "operator-taught knowledge saved" }],
  };
}

export async function teachOperatorMemory(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const branch = resolveBranch(context);
  const userEmail = resolveUserEmail(context);
  const teach = (context.teachPayload as { fact?: string } | undefined) || parseTeachNacCommand(String(context.question || ""));
  if (!teach?.fact) throw new Error("No operator knowledge text found.");
  if (!userEmail) throw new Error("Authenticated user email required to teach operator knowledge.");
  const result = await storeOperatorMemory(supabase, { branch, fact: teach.fact, taughtBy: userEmail });
  return { branch, branchLabel: branch ? branchDisplayName(branch) : "Network", ...result };
}

export async function provideManualInputForSession(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const branch = resolveBranch(context);
  const userEmail = resolveUserEmail(context);
  const manualInput = context.manualInputPayload as { metricKey: string; metricLabel?: string; metricValue: number } | undefined;
  const pendingSession = context.pendingSession as { id?: string; context?: { vaultPeriod?: ReturnType<typeof resolveWeekEndingPeriod> } } | undefined;
  const vaultPeriod = pendingSession?.context?.vaultPeriod || resolveWeekEndingPeriod(String(context.question || ""));
  if (!branch || !userEmail || !manualInput) throw new Error("Manual input requires branch, user, and parsed value.");
  return runWeeklyDashboardSession(supabase, {
    branch,
    branchLabel: branchDisplayName(branch),
    userEmail,
    question: String(context.question || ""),
    period: vaultPeriod,
    pendingSessionId: pendingSession?.id,
    manualInput,
    profile: context.profile as Record<string, unknown> | null,
  });
}

export async function generateWeeklyDashboard(supabase: SupabaseClient, context: Record<string, unknown> = {}) {
  const branch = resolveBranch(context);
  const userEmail = resolveUserEmail(context);
  if (!branch) throw new Error("Branch scope required for weekly dashboard.");
  if (!userEmail) throw new Error("Authenticated user email required.");
  const vaultPeriod = resolveWeekEndingPeriod(String(context.question || ""));
  const conversationContext = context.conversationContext as { pendingSessionId?: string } | undefined;
  return runWeeklyDashboardSession(supabase, {
    branch,
    branchLabel: branchDisplayName(branch),
    userEmail,
    question: String(context.question || ""),
    period: vaultPeriod,
    pendingSessionId: conversationContext?.pendingSessionId || null,
    profile: context.profile as Record<string, unknown> | null,
  });
}

export async function resolveHumanInTheLoopTurn({
  question,
  conversationContext = null,
  supabase = null,
  branch = null,
  userEmail = null,
}: {
  question?: string;
  conversationContext?: Record<string, unknown> | null;
  supabase?: SupabaseClient | null;
  branch?: string | null;
  userEmail?: string | null;
} = {}) {
  const teach = parseTeachNacCommand(question || "");
  if (teach) {
    return {
      overrideIntent: VAULT_INTENTS.TEACH_OPERATOR,
      teachPayload: teach,
      resolutionNotes: ["Recognized Teach NAC / operator knowledge command."],
    };
  }

  if (!supabase || !branch || !userEmail) return null;

  let pendingSession = null;
  const sessionId = conversationContext?.pendingSessionId as string | undefined;
  if (sessionId) pendingSession = await fetchPendingSession(supabase, sessionId);
  if (!pendingSession || pendingSession.status !== "pending") {
    pendingSession = await fetchActivePendingSession(supabase, {
      branch,
      createdBy: userEmail,
      sessionType: "weekly_dashboard",
    });
  }
  if (!pendingSession || pendingSession.status !== "pending") return null;

  const awaitingInput = Boolean(conversationContext?.awaitingInput) || pendingSession.status === "pending";
  if (!isLikelyManualInputAnswer(question || "", { pendingSessionId: pendingSession.id, awaitingInput })) return null;

  const parsed = parseManualInputAnswer(question || "", pendingSession.missingFields as { key?: string; label?: string; aliases?: string[] }[]);
  if (!parsed) return null;

  return {
    overrideIntent: VAULT_INTENTS.PROVIDE_MANUAL_INPUT,
    manualInputPayload: parsed,
    pendingSession,
    resolutionNotes: [`Recognized manual input for pending session ${pendingSession.id.slice(0, 8)}…`],
  };
}

export function buildTeachOperatorAnswer(route: Record<string, unknown>, tool: Record<string, unknown> | null, readiness: Record<string, unknown> | null) {
  const memory = tool?.memory as { fact?: string; category?: string; id?: string } | undefined;
  const branchLabel = String(tool?.branchLabel || route?.branchMention || "Network");
  return {
    answerType: "executive",
    title: "Operator knowledge saved",
    directAnswer: memory ? `Saved for ${branchLabel}: "${memory.fact}"` : "Operator knowledge could not be saved.",
    keyMetrics: memory ? [{ label: "Category", value: memory.category, source: "operator_memory" }] : [],
    insights: ["This fact is stored as permanent operator knowledge and will be used in future why-answers with source attribution."],
    recommendations: [],
    sources: ((tool?.sources as { name: string; detail: string }[]) || []).map((s) => ({ name: s.name, detail: s.detail })),
    warnings: tool?.error ? [String(tool.error)] : [],
    confidence: memory ? "high" : "none",
    isAiGenerated: false,
    intent: VAULT_INTENTS.TEACH_OPERATOR,
    branchLabel,
    readiness,
    diagnostics: { memoryId: memory?.id || null },
  };
}

export function buildManualInputPendingAnswer(route: Record<string, unknown>, tool: Record<string, unknown> | null, readiness: Record<string, unknown> | null) {
  const field = tool?.promptField as { label?: string; prompt?: string } | undefined;
  const session = tool?.pendingSession as { id?: string; status?: string } | undefined;
  const branchLabel = String(tool?.branchLabel || "Branch");
  const periodLabel = (tool?.vaultPeriod as { periodLabel?: string } | undefined)?.periodLabel || "this period";
  return {
    answerType: "executive",
    title: `Weekly dashboard · ${branchLabel}`,
    directAnswer: field
      ? `To complete the weekly dashboard for ${periodLabel}, I need ${field.label}. ${field.prompt || `Please provide ${field.label}.`}`
      : "Additional manual input is required to complete this dashboard.",
    keyMetrics: [],
    insights: ["Manual inputs apply to this reporting period only — they are not reused for other weeks."],
    recommendations: ['Reply with the value (e.g. "82 covers" or "7Rooms covers were 82").'],
    sources: ((tool?.sources as { name: string; detail: string }[]) || []).map((s) => ({ name: s.name, detail: s.detail })),
    warnings: [],
    confidence: "medium",
    isAiGenerated: false,
    intent: route.intent,
    branchLabel,
    periodLabel,
    readiness,
    awaitingInput: true,
    pendingSession: session ? { id: session.id, status: session.status, missingFields: tool?.missingFields } : null,
    pendingSessionId: session?.id || null,
  };
}

export function buildWeeklyDashboardCompleteAnswer(route: Record<string, unknown>, tool: Record<string, unknown> | null, readiness: Record<string, unknown> | null) {
  const lines = buildWeeklyDashboardAnswerLines(tool || {});
  const branchLabel = String(tool?.branchLabel || "Branch");
  const aggregation = tool?.aggregation as Record<string, unknown> | undefined;
  const manualInputs = tool?.manualInputs as Record<string, unknown> | undefined;
  const confidenceResult = tool?.confidenceResult as { level?: string; dataConfidence?: unknown } | undefined;
  const pkg = tool?.weeklyDashboardPackage as Record<string, unknown> | null;
  const endDate = (tool?.vaultPeriod as { endDate?: string } | undefined)?.endDate || "week";
  const xlsxName = pkg ? `NAC-Weekly-Dashboard-${String(tool?.branch || "branch").toLowerCase()}-${String(endDate).slice(0, 10)}.xlsx` : null;

  return {
    answerType: "executive",
    title: `Weekly dashboard · ${branchLabel}`,
    directAnswer: [
      ...lines,
      "",
      xlsxName
        ? `Management XLSX ready: ${xlsxName} — use Download XLSX to save the workbook (Dashboard, Data, Source, 90 Days).`
        : "Dashboard summary complete — XLSX export data could not be assembled.",
    ].join("\n"),
    keyMetrics: [
      aggregation?.totalSales != null
        ? { label: "Total sales", value: `${Number(aggregation.totalSales).toLocaleString()} SAR`, source: "vault" }
        : null,
      manualInputs?.seven_rooms_covers != null
        ? { label: "7Rooms covers", value: String(manualInputs.seven_rooms_covers), source: "manual_input" }
        : null,
    ].filter(Boolean),
    insights: (tool?.coverageAssessment as { coverageNotes?: string[] } | undefined)?.coverageNotes || [],
    recommendations: [xlsxName ? "Download the XLSX workbook for the full management dashboard." : "Review vault coverage before sharing externally."],
    sources: ((tool?.sources as { name: string; detail: string }[]) || []).map((s) => ({ name: s.name, detail: s.detail })),
    warnings: [],
    confidence: confidenceResult?.level || "medium",
    dataConfidence: confidenceResult?.dataConfidence,
    isAiGenerated: false,
    intent: VAULT_INTENTS.WEEKLY_DASHBOARD,
    branchLabel,
    periodLabel: (tool?.vaultPeriod as { periodLabel?: string } | undefined)?.periodLabel,
    readiness,
    awaitingInput: false,
    pendingSession: tool?.pendingSession ? { id: (tool.pendingSession as { id: string }).id, status: "complete" } : null,
    pendingSessionId: null,
    weeklyDashboardPackage: pkg,
    exportOptions: pkg ? [{ format: "weekly_dashboard_xlsx", label: "Download XLSX", filename: xlsxName }] : [],
    diagnostics: { weeklyDashboardSheets: ["Dashboard", "Data", "Source", "90 Days"] },
  };
}

export function buildWeeklyDashboardAnswer(route: Record<string, unknown>, tool: Record<string, unknown> | null, readiness: Record<string, unknown> | null) {
  if (tool?.status === "pending") return buildManualInputPendingAnswer(route, tool, readiness);
  return buildWeeklyDashboardCompleteAnswer(route, tool, readiness);
}
