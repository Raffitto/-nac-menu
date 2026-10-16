/**
 * Bounded Ask NAC investigation loop.
 * The model may choose an allowlisted read. It cannot send SQL.
 * Every financial sentence is checked against tool evidence.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchCashUpRangeAggregationViaRpc } from "./askNacCashUpRangeRpc.ts";
import {
  AGENT_LIMITS,
  AGENT_TOOL_CATALOG,
  authorizeToolCall,
  boundConversationContext,
  buildWeekdayComparisonText,
  composeDeliveryCountAndRevenue,
  deliveryAverageOrderValue,
  isSameWeekdayBackQuestion,
  resolveAnchorDate,
  sameWeekdaySeries,
  untilDateFromQuestion,
  verifyAnswerAgainstEvidence,
} from "./askNacAgentPolicy.ts";

type ToolExecutor = (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
type ModelComplete = (system: string, user: string) => Promise<{ content: string | null; promptTokens: number; completionTokens: number }>;

const SYSTEM = [
  "You are Ask NAC, investigating published restaurant data for one authorized user.",
  "Choose one allowlisted tool, or give a final answer that uses only numbers present in the tool evidence.",
  "Return JSON only: {\"action\":\"call_tool\",\"tool\":\"name\",\"args\":{...}} or {\"action\":\"final\",\"answer\":\"...\",\"hypotheses\":[],\"unavailable\":[]}.",
  "Never invent sales, orders, covers, or dates. If evidence is missing, say it is missing.",
  "Label a hypothesis as a hypothesis. Do not call a hypothesis a fact.",
  "Do not request SQL. Tools: " + AGENT_TOOL_CATALOG.map((tool) => `${tool.name}: ${tool.description}`).join(" "),
].join(" ");

function dayRow(row: Record<string, unknown>) {
  return {
    date: String(row.date || row.businessDate || ""),
    orders: numberOrNull(row.totalDeliveryOrders ?? row.deliveryOrders),
    sales: numberOrNull(row.totalDeliverySales ?? row.deliverySales),
    netSales: numberOrNull(row.totalSales),
  };
}

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function executeCashUpTool(
  supabase: SupabaseClient,
  tool: string,
  args: Record<string, unknown>,
) {
  if (tool === "weekday_series") {
    const dates = sameWeekdaySeries(String(args.anchorDate || ""), String(args.untilDate || ""));
    if (!dates.length) return { tool, error: "invalid_series", evidenceNumbers: [] };
    const agg = await fetchCashUpRangeAggregationViaRpc(supabase, {
      branch: (args.branch as string) || null,
      startDate: dates[dates.length - 1],
      endDate: dates[0],
      includeDailyBreakdown: true,
    });
    const daily = Array.isArray(agg.dailyBreakdown) ? agg.dailyBreakdown as Record<string, unknown>[] : [];
    const rowsByDate: Record<string, { orders: number | null; sales: number | null }> = {};
    for (const row of daily) {
      const mapped = dayRow(row);
      if (mapped.date) rowsByDate[mapped.date] = { orders: mapped.orders, sales: mapped.sales };
    }
    const comparison = buildWeekdayComparisonText({
      branchLabel: String(args.branchLabel || args.branch || "The authorized branch"),
      metricLabel: "delivery",
      dates,
      rowsByDate,
    });
    return {
      tool,
      dates,
      rows: dates.map((date) => ({ date, ...(rowsByDate[date] || { orders: null, sales: null }) })),
      text: comparison.text,
      missing: comparison.missing,
      evidenceNumbers: comparison.evidenceNumbers,
    };
  }

  const startDate = String(args.startDate || "");
  const endDate = String(args.endDate || "");
  const agg = await fetchCashUpRangeAggregationViaRpc(supabase, {
    branch: (args.branch as string) || null,
    startDate,
    endDate,
    includeDailyBreakdown: true,
  });
  const daily = (Array.isArray(agg.dailyBreakdown) ? agg.dailyBreakdown as Record<string, unknown>[] : []).slice(0, 31).map(dayRow);
  const evidenceNumbers = [
    agg.totalDeliveryOrders,
    agg.totalDeliverySales,
    agg.totalSales,
    agg.totalGuests,
    agg.totalOrders,
  ].filter((value) => value != null).map((value) => Number(value));
  if (tool === "delivery_summary") {
    const composed = composeDeliveryCountAndRevenue({
      branchLabel: String(args.branch || "The branch"),
      periodLabel: `${startDate} to ${endDate}`,
      orders: agg.totalDeliveryOrders,
      sales: agg.totalDeliverySales,
      coverageStart: daily[0]?.date || startDate,
      coverageEnd: daily[daily.length - 1]?.date || endDate,
      platforms: (agg.deliveryPlatformBreakdown || null) as Record<string, { orders?: number | null; sales?: number | null }> | null,
    });
    return {
      tool,
      orders: agg.totalDeliveryOrders,
      sales: agg.totalDeliverySales,
      averageOrderValue: deliveryAverageOrderValue(agg.totalDeliveryOrders, agg.totalDeliverySales),
      text: composed.text,
      daily,
      evidenceNumbers: [...new Set([...evidenceNumbers, ...composed.evidenceNumbers])],
    };
  }
  if (tool === "coverage_status") {
    return {
      tool,
      publishedDates: daily.map((row) => row.date).filter(Boolean),
      dayCount: agg.dayCount,
      evidenceNumbers,
    };
  }
  return {
    tool,
    netSales: agg.totalSales,
    guests: agg.totalGuests,
    orders: agg.totalOrders,
    deliveryOrders: agg.totalDeliveryOrders,
    deliverySales: agg.totalDeliverySales,
    daily,
    evidenceNumbers,
  };
}

function evidenceNumbersFrom(packets: Record<string, unknown>[]) {
  const numbers: number[] = [];
  for (const packet of packets) {
    const listed = packet.evidenceNumbers;
    if (Array.isArray(listed)) {
      for (const value of listed) {
        const n = Number(value);
        if (Number.isFinite(n)) numbers.push(n);
      }
    }
  }
  return numbers;
}

export async function runAskNacAgent({
  question,
  branchHint,
  allowedBranchIds,
  allBranches,
  executeTool,
  completeModel,
}: {
  question: string;
  branchHint?: string | null;
  allowedBranchIds: string[];
  allBranches: boolean;
  executeTool: ToolExecutor;
  completeModel: ModelComplete;
}) {
  const started = Date.now();
  const packets: Record<string, unknown>[] = [];
  const trace: Array<Record<string, unknown>> = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let toolCalls = 0;

  for (let round = 0; round < AGENT_LIMITS.maxModelRounds; round += 1) {
    const user = JSON.stringify({
      question,
      branchHint: branchHint || null,
      allowedBranchIds,
      evidence: packets.map((packet) => ({
        tool: packet.tool,
        error: packet.error || null,
        text: packet.text || null,
        orders: packet.orders ?? null,
        sales: packet.sales ?? null,
        netSales: packet.netSales ?? null,
        missing: packet.missing || null,
        publishedDates: packet.publishedDates || null,
      })),
    });
    const model = await completeModel(SYSTEM, user);
    promptTokens += model.promptTokens;
    completionTokens += model.completionTokens;
    let decision: Record<string, unknown> | null = null;
    try {
      decision = model.content ? JSON.parse(model.content) : null;
    } catch {
      decision = null;
    }
    if (!decision || (decision.action !== "call_tool" && decision.action !== "final")) {
      trace.push({ round, event: "invalid_model_json" });
      break;
    }
    if (decision.action === "final") {
      const answer = String(decision.answer || "");
      const verdict = verifyAnswerAgainstEvidence(answer, evidenceNumbersFrom(packets));
      trace.push({ round, event: verdict.ok ? "final_verified" : "final_rejected" });
      return {
        used: true,
        verified: verdict.ok,
        directAnswer: verdict.ok
          ? answer
          : packets.map((packet) => packet.text).filter(Boolean).join(" ")
            || "I could not verify a figure for that question against published Cash Up, so I am not stating one.",
        confidence: verdict.ok ? "medium" : "low",
        hypotheses: Array.isArray(decision.hypotheses) ? decision.hypotheses.map(String).slice(0, 4) : [],
        unavailable: Array.isArray(decision.unavailable) ? decision.unavailable.map(String).slice(0, 4) : [],
        trace,
        promptTokens,
        completionTokens,
        toolCalls,
        latencyMs: Date.now() - started,
      };
    }
    if (toolCalls >= AGENT_LIMITS.maxToolCalls) {
      trace.push({ round, event: "tool_budget_exhausted" });
      break;
    }
    const gate = authorizeToolCall({
      tool: String(decision.tool || ""),
      args: (decision.args || {}) as Record<string, unknown>,
      allowedBranchIds,
      allBranches,
    });
    if (!gate.ok) {
      packets.push({ tool: decision.tool, error: gate.error, evidenceNumbers: [] });
      trace.push({ round, event: gate.error });
      continue;
    }
    toolCalls += 1;
    try {
      const result = await executeTool(String(decision.tool), gate.args);
      packets.push(result);
      trace.push({ round, event: "tool", tool: decision.tool });
    } catch (err) {
      packets.push({ tool: decision.tool, error: "tool_failed", evidenceNumbers: [] });
      trace.push({ round, event: "tool_failed" });
      console.info(JSON.stringify({ fn: "ask-nac-agent", tool: decision.tool, failed: true }));
      void err;
    }
  }

  const fallback = packets.map((packet) => packet.text).filter(Boolean).join(" ");
  return {
    used: true,
    verified: false,
    directAnswer: fallback || "I do not have enough published evidence to answer that yet.",
    confidence: "low",
    hypotheses: [],
    unavailable: ["verified_answer"],
    trace,
    promptTokens,
    completionTokens,
    toolCalls,
    latencyMs: Date.now() - started,
  };
}

export async function runWeekdayFollowUp(
  supabase: SupabaseClient,
  {
    question,
    context,
    branch,
    allowedBranchIds,
    allBranches,
    branchLabel,
  }: {
    question: string;
    context: Record<string, unknown> | null;
    branch: string | null;
    allowedBranchIds: string[];
    allBranches: boolean;
    branchLabel: string;
  },
) {
  if (!isSameWeekdayBackQuestion(question)) return null;
  const anchor = resolveAnchorDate(context);
  const until = anchor ? untilDateFromQuestion(question, anchor) : null;
  if (!anchor || !until) {
    return {
      directAnswer: "Tell me which day to start from, and I will compare that weekday back through the month you named. I will not guess the day.",
      confidence: "low",
      verified: false,
      intent: "conversation",
    };
  }
  const gate = authorizeToolCall({
    tool: "weekday_series",
    args: { branch, anchorDate: anchor, untilDate: until },
    allowedBranchIds,
    allBranches,
  });
  if (!gate.ok) {
    return {
      directAnswer: "That branch is outside your access, so I did not read it.",
      confidence: "high",
      verified: true,
      intent: "conversation",
      warnings: ["unauthorized_branch"],
    };
  }
  const result = await executeCashUpTool(supabase, "weekday_series", {
    ...gate.args,
    branch: gate.args.branch || branch,
    branchLabel,
  });
  const text = String(result.text || "");
  const evidence = Array.isArray(result.evidenceNumbers) ? result.evidenceNumbers as number[] : [];
  const verdict = text ? verifyAnswerAgainstEvidence(text, evidence) : { ok: false, invented: [] };
  const missing = Array.isArray(result.missing) ? result.missing : [];
  return {
    directAnswer: verdict.ok ? text : "I could not verify that weekday comparison against published Cash Up, so I am not stating figures.",
    confidence: verdict.ok && missing.length === 0 ? "high" : "low",
    verified: verdict.ok,
    intent: "vault_cash_up_summary",
    warnings: missing.length ? ["Some requested weekdays are not published."] : [],
    branchLabel,
    anchorDate: anchor,
  };
}

export async function completeAgentModel(system: string, user: string) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return { content: null, promptTokens: 0, completionTokens: 0 };
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: AGENT_LIMITS.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) return { content: null, promptTokens: 0, completionTokens: 0 };
  const body = await res.json();
  return {
    content: body?.choices?.[0]?.message?.content || null,
    promptTokens: Number(body?.usage?.prompt_tokens) || 0,
    completionTokens: Number(body?.usage?.completion_tokens) || 0,
  };
}

export async function loadConversationMemory(
  supabase: SupabaseClient,
  userId: string,
  branchKey: string,
) {
  const { data, error } = await supabase
    .from("ask_nac_conversation_memory")
    .select("context, updated_at")
    .eq("user_id", userId)
    .eq("branch_key", branchKey || "")
    .maybeSingle();
  if (error || !data?.context) return null;
  const updated = new Date(String(data.updated_at || "")).getTime();
  if (!Number.isFinite(updated) || Date.now() - updated > AGENT_LIMITS.retentionDays * 24 * 60 * 60 * 1000) {
    return null;
  }
  return boundConversationContext(data.context as Record<string, unknown>);
}

export async function saveConversationMemory(
  supabase: SupabaseClient,
  userId: string,
  branchKey: string,
  context: Record<string, unknown>,
) {
  const bounded = boundConversationContext(context);
  const { error } = await supabase.from("ask_nac_conversation_memory").upsert({
    user_id: userId,
    branch_key: branchKey || "",
    context: bounded,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,branch_key" });
  if (error) {
    console.info(JSON.stringify({ fn: "ask-nac", memory: "not_saved", code: error.code || "error" }));
  }
}
