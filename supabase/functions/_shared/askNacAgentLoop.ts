/**
 * Bounded Ask NAC investigation loop.
 * The model may choose an allowlisted read. It cannot send SQL.
 * Every financial sentence is checked against tool evidence.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchCashUpRangeAggregationViaRpc } from "./askNacCashUpRangeRpc.ts";
import { fetchLogbookMonthSummaryViaRpc } from "./askNacLogbookMonthRpc.ts";
import { fetchAskNacMenuMetrics } from "./askNacMenuMetrics.ts";
import { queryGoogleReviewCountEdge } from "./askNacGoogleReviewTools.ts";
import { searchVaultDocuments } from "./askNacVaultTools.ts";
import { getFoodicsTopItems } from "./askNacFoodicsTools.ts";
import {
  AGENT_LIMITS,
  AGENT_TOOL_CATALOG,
  authorizeToolCall,
  boundConversationContext,
  buildWeekdayComparisonText,
  completenessGaps,
  composeDeliveryCountAndRevenue,
  describeSalesDirection,
  deliveryAverageOrderValue,
  explicitDays,
  questionRequiresRetrievedEvidence,
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
  "If the question has more than one part, call another tool before the final answer.",
  "Do not explain a sales change from the sales total alone. Call logbook_summary or knowledge_search, and say when those sources are empty.",
  "menu_performance has QR scans and sessions only. It does not rank dishes.",
  "uploaded_product_sales reads an uploaded file. If none exists, say so. It is not a live Foodics connection.",
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

function collectNumbers(values: unknown[]) {
  return values.filter((value) => value != null && Number.isFinite(Number(value))).map((value) => Number(value));
}

async function readCashUp(supabase: SupabaseClient, branch: string | null, startDate: string, endDate: string) {
  return fetchCashUpRangeAggregationViaRpc(supabase, {
    branch,
    startDate,
    endDate,
    includeDailyBreakdown: false,
  });
}

export async function executeCashUpTool(
  supabase: SupabaseClient,
  tool: string,
  args: Record<string, unknown>,
  scope: { profile?: Record<string, unknown> | null } = {},
) {
  const branch = (args.branch as string) || null;
  const startDate = String(args.startDate || "");
  const endDate = String(args.endDate || "");

  if (tool === "branch_compare") {
    const branches = (args.branches as string[]) || [];
    const sides = [];
    for (const id of branches.slice(0, 2)) {
      const agg = await readCashUp(supabase, id, startDate, endDate);
      sides.push({ branch: id, netSales: agg.totalSales, guests: agg.totalGuests, orders: agg.totalOrders });
    }
    return {
      tool,
      sides,
      text: sides.map((side) => `${side.branch}: net sales ${side.netSales ?? "not published"}, guests ${side.guests ?? "not published"}, orders ${side.orders ?? "not published"}.`).join(" "),
      evidenceNumbers: collectNumbers(sides.flatMap((side) => [side.netSales, side.guests, side.orders])),
    };
  }

  if (tool === "period_compare") {
    const current = await readCashUp(supabase, branch, startDate, endDate);
    const previous = await readCashUp(supabase, branch, String(args.compareStart || ""), String(args.compareEnd || ""));
    return {
      tool,
      current: { netSales: current.totalSales, guests: current.totalGuests },
      previous: { netSales: previous.totalSales, guests: previous.totalGuests },
      text: `${branch || "branch"} ${startDate} to ${endDate}: net sales ${current.totalSales ?? "not published"}. ${args.compareStart} to ${args.compareEnd}: net sales ${previous.totalSales ?? "not published"}.`,
      evidenceNumbers: collectNumbers([current.totalSales, current.totalGuests, previous.totalSales, previous.totalGuests]),
    };
  }

  if (tool === "logbook_summary") {
    const bundle = await fetchLogbookMonthSummaryViaRpc(supabase, { branch, startDate, endDate });
    const facts = ((bundle as { facts?: Record<string, unknown>[] }).facts || []).slice(0, 20);
    const evidenceNumbers = collectNumbers(facts.map((fact) => fact.metricValue));
    const lines = facts.map((fact) => `${fact.metricKey}: ${fact.metricValue ?? "not published"}`);
    return {
      tool,
      text: lines.length ? lines.join(". ") : "No published logbook summary for that branch and period.",
      evidenceNumbers,
      unavailable: lines.length ? [] : ["logbook"],
    };
  }

  if (tool === "menu_performance") {
    const hours = Number(args.hours) || 168;
    const metrics = await fetchAskNacMenuMetrics(supabase as unknown as { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }, { branch, hours });
    return {
      tool,
      qrScans: metrics.menuQrScans,
      sessions: metrics.menuSessions,
      text: `Menu rollup for ${branch || "the authorized scope"} over ${hours} hours: ${metrics.menuQrScans ?? "not available"} QR scans and ${metrics.menuSessions ?? "not available"} sessions. Dish rankings are not in this rollup.`,
      evidenceNumbers: collectNumbers([metrics.menuQrScans, metrics.menuSessions]),
      unavailable: ["dish_rankings"],
    };
  }

  if (tool === "google_reviews") {
    const reviews = await queryGoogleReviewCountEdge(supabase, {
      branchMention: branch,
      filters: { branch },
      question: `${startDate} ${endDate}`,
    });
    return {
      tool,
      text: reviews.warnings?.length
        ? String(reviews.warnings[0])
        : `${reviews.branchLabel}: rating ${reviews.currentRating ?? "not published"}, review count ${reviews.currentReviewCount ?? "not published"}, change ${reviews.reviewDelta ?? "not published"}.`,
      evidenceNumbers: collectNumbers([reviews.currentRating, reviews.currentReviewCount, reviews.reviewDelta]),
      unavailable: reviews.warnings?.length ? ["google_reviews"] : [],
    };
  }

  if (tool === "knowledge_search") {
    const found = await searchVaultDocuments(supabase, {
      searchTerms: String(args.searchTerms || "").slice(0, 80),
      question: String(args.searchTerms || ""),
      branchMention: branch,
      filters: { branch },
      profile: scope.profile || null,
    });
    const matches = ((found as { matches?: Record<string, unknown>[] }).matches || []).slice(0, 5);
    const titles = matches.map((match) => String(match.title || match.fileTitle || "Untitled")).slice(0, 5);
    return {
      tool,
      titles,
      text: titles.length ? `Company knowledge matches: ${titles.join("; ")}.` : "No company knowledge document matched that search.",
      evidenceNumbers: [],
    };
  }

  if (tool === "operational_day") {
    const day = startDate || endDate;
    const cash = await readCashUp(supabase, branch, day, day);
    const logbook = await fetchLogbookMonthSummaryViaRpc(supabase, { branch, startDate: day, endDate: day });
    const facts = ((logbook as { facts?: Record<string, unknown>[] }).facts || []).slice(0, 8);
    return {
      tool,
      text: [
        `${branch || "branch"} on ${day}: net sales ${cash.totalSales ?? "not published"}, guests ${cash.totalGuests ?? "not published"}, delivery orders ${cash.totalDeliveryOrders ?? "not published"}.`,
        facts.length ? `Logbook: ${facts.map((fact) => `${fact.metricKey} ${fact.metricValue ?? "n/a"}`).join("; ")}.` : "No logbook summary is published for that date.",
      ].join(" "),
      evidenceNumbers: collectNumbers([
        cash.totalSales,
        cash.totalGuests,
        cash.totalDeliveryOrders,
        cash.totalDeliverySales,
        ...facts.map((fact) => fact.metricValue),
      ]),
    };
  }

  if (tool === "uploaded_product_sales") {
    const uploaded = await getFoodicsTopItems(supabase, {
      branchMention: branch,
      filters: { branch },
      profile: scope.profile || null,
      foodicsPeriod: { startDate, endDate, label: `${startDate} to ${endDate}` },
      rankingBasis: "net_sales",
      topLimit: 8,
    });
    if ((uploaded as { authorizationDenied?: boolean }).authorizationDenied) {
      return { tool, error: "branch_denied", text: "That branch is outside your access.", evidenceNumbers: [] };
    }
    const items = ((uploaded as { topItems?: Record<string, unknown>[] }).topItems || []).slice(0, 8);
    if (!items.length || (uploaded as { missingBatch?: boolean }).missingBatch) {
      return {
        tool,
        text: "No uploaded waiter or product sales file covers that period. Foodics is not a live feed, so I am not estimating item or waiter sales.",
        evidenceNumbers: [],
        unavailable: ["product_sales", "waiter_sales"],
      };
    }
    const lines = items.map((item) => `${item.name || item.product_name || "item"}: ${item.net_sales ?? item.netSales ?? "n/a"}`);
    return {
      tool,
      text: lines.join(". "),
      evidenceNumbers: collectNumbers(items.map((item) => item.net_sales ?? item.netSales)),
    };
  }

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
    const salesMetric = /sale|revenue/.test(String(args.metric || ""));
    const rowsByDate: Record<string, { orders?: number | null; sales?: number | null; value?: number | null }> = {};
    for (const row of daily) {
      const mapped = dayRow(row);
      if (!mapped.date) continue;
      rowsByDate[mapped.date] = salesMetric
        ? { value: mapped.netSales }
        : { orders: mapped.orders, sales: mapped.sales };
    }
    const comparison = buildWeekdayComparisonText({
      branchLabel: String(args.branchLabel || args.branch || "The authorized branch"),
      metricLabel: salesMetric ? "net sales" : "delivery",
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
    if (Date.now() - started > 20000) {
      trace.push({ round, event: "time_budget_exhausted" });
      break;
    }
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
    if (decision.action === "final" && toolCalls === 0 && questionRequiresRetrievedEvidence(question)) {
      const dates = explicitDays(question);
      if (dates.length >= 2) {
        const gate = authorizeToolCall({
          tool: "period_compare",
          args: {
            branch: branchHint || null,
            startDate: dates[0],
            endDate: dates[0],
            compareStart: dates[1],
            compareEnd: dates[1],
          },
          allowedBranchIds,
          allBranches,
        });
        if (gate.ok) {
          try {
            const gathered = await executeTool("period_compare", gate.args);
            toolCalls += 1;
            packets.push(gathered);
            const current = (gathered.current || {}) as { netSales?: number | null };
            const previous = (gathered.previous || {}) as { netSales?: number | null };
            const text = describeSalesDirection(dates[0], current.netSales ?? null, dates[1], previous.netSales ?? null);
            const gap = current.netSales != null && previous.netSales != null
              ? Math.round(Math.abs(Number(current.netSales) - Number(previous.netSales)) * 100) / 100
              : null;
            const verdict = verifyAnswerAgainstEvidence(text, [current.netSales, previous.netSales, gap].filter((value) => value != null).map(Number));
            trace.push({ round, event: "deterministic_evidence_fallback" });
            return {
              used: true,
              verified: verdict.ok,
              directAnswer: verdict.ok ? text : "I could not verify the two days against published Cash Up, so I am not stating which was lower.",
              confidence: verdict.ok && current.netSales != null && previous.netSales != null ? "high" : "low",
              hypotheses: [],
              unavailable: current.netSales == null || previous.netSales == null ? ["net_sales"] : [],
              trace,
              promptTokens,
              completionTokens,
              toolCalls,
              latencyMs: Date.now() - started,
            };
          } catch {
            trace.push({ round, event: "tool_failed" });
          }
        }
      }
    }
    if (decision.action === "final") {
      const toolsUsed = packets.map((packet) => String(packet.tool || ""));
      const gaps = completenessGaps(question, String(decision.answer || ""), toolsUsed);
      const answer = gaps.length
        ? `${decision.answer} I am not filling the missing part (${gaps.join(", ")}) without evidence.`
        : String(decision.answer || "");
      const verdict = verifyAnswerAgainstEvidence(answer, evidenceNumbersFrom(packets));
      trace.push({ round, event: verdict.ok ? "final_verified" : "final_rejected", gaps });
      return {
        used: true,
        verified: verdict.ok && gaps.length === 0,
        directAnswer: verdict.ok
          ? answer
          : packets.map((packet) => packet.text).filter(Boolean).join(" ")
            || "I could not verify a figure for that question against published evidence, so I am not stating one.",
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
    metric,
  }: {
    question: string;
    context: Record<string, unknown> | null;
    branch: string | null;
    allowedBranchIds: string[];
    allBranches: boolean;
    branchLabel: string;
    metric?: string | null;
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
    metric: metric || null,
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
