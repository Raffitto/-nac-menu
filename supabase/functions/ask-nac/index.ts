/**
 * Ask NAC Edge Function — auth + read-only RPC tools + Phase D hybrid MTD + optional OpenAI explanation.
 * Deploy: supabase functions deploy ask-nac
 * Secrets: OPENAI_API_KEY (optional), SUPABASE_URL, SUPABASE_ANON_KEY (auto in Edge)
 *
 * Menu metric parity: supabase/functions/_shared/askNacMenuMetrics.ts
 * must stay in sync with src/intelligence/askNac/shared/askNacMenuMetrics.js
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchAskNacMenuMetrics } from "../_shared/askNacMenuMetrics.ts";
import { buildMenuMetricAnswerFields } from "../_shared/askNacResponseHelpers.ts";
import { MONTH_HOURS } from "../_shared/mtdHybridMerge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ROWS = 12;

const INTENTS = {
  MENU_QR: "menu_qr_scans",
  MENU_SESSIONS: "menu_sessions",
  GOOGLE_REDIRECTS: "google_redirects",
  REVIEW_QR: "review_qr_scans",
  STAFF_LEADERBOARD: "staff_redirect_leaderboard",
  BRANCH_COMPARE: "branch_comparison",
  AVG_SPEND: "avg_spend_per_guest",
  DELIVERY: "delivery_sales",
  GOOGLE_REVIEWS: "google_reviews",
  FOODICS_SALES_TOTAL: "sales_total",
  FOODICS_TOP_ITEMS: "top_items",
  FOODICS_TOP_COMPARE: "top_items_compare",
  FOODICS_RANK_CHANGE: "item_rank_change",
  FOODICS_CATEGORY: "category_sales",
  FOODICS_BRANCH_SALES: "branch_sales",
  FOODICS: "foodics_query",
  UNKNOWN: "unknown",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function routeIntent(question = "") {
  const q = question.toLowerCase();
  if (/\b(avg|average).*(spend|ticket).*(guest|customer)\b/.test(q)) return INTENTS.AVG_SPEND;
  if (/\b(delivery|hungerstation|jahez|talabat)\b/.test(q)) return INTENTS.DELIVERY;
  if (/\b(actual google review|google review count)\b/.test(q)) return INTENTS.GOOGLE_REVIEWS;
  if (/\b(entered|dropped)\b.*\btop\b/.test(q)) return INTENTS.FOODICS_RANK_CHANGE;
  if (/\b(compare|compared|vs|versus)\b.*\btop\b/.test(q)) return INTENTS.FOODICS_TOP_COMPARE;
  if (/\b(top \d+|top ten|best sellers?|top items?)\b/.test(q)) return INTENTS.FOODICS_TOP_ITEMS;
  if (/\b(category|categories)\b.*\b(revenue|sales|sold|most)\b/.test(q)) return INTENTS.FOODICS_CATEGORY;
  if (/\b(sales|revenue).*\b(by branch|each branch|which branch)\b/.test(q)) return INTENTS.FOODICS_BRANCH_SALES;
  if (/\b(total sales|what were sales|sales in|revenue in)\b/.test(q)) return INTENTS.FOODICS_SALES_TOTAL;
  if (/\bfoodics\b/.test(q)) return INTENTS.FOODICS;
  if (/\b(staff|waiter).*(leaderboard|top|redirect|drove|drive|most)\b/.test(q)) return INTENTS.STAFF_LEADERBOARD;
  if (/\bcompare branches\b/.test(q)) return INTENTS.BRANCH_COMPARE;
  if (/\b(branch|branches).*(compare|comparison)\b/.test(q)) return INTENTS.BRANCH_COMPARE;
  if (/\b(staff|waiter|employee|who|which)\b/.test(q) && /\b(redirect|google)\b/.test(q)) {
    return INTENTS.STAFF_LEADERBOARD;
  }
  if (/\bgoogle redirect/.test(q) && !/\b(staff|waiter|who|which)\b/.test(q)) return INTENTS.GOOGLE_REDIRECTS;
  if (/\b(review qr|review card|review portal)\b/.test(q)) return INTENTS.REVIEW_QR;
  if (/\b(menu qr|menu scan)/.test(q)) return INTENTS.MENU_QR;
  if (/\b(menu session|sessions)\b/.test(q) && !/\breview\b/.test(q)) return INTENTS.MENU_SESSIONS;
  if (/\b(qr|scan)/.test(q) && !/\breview\b/.test(q)) return INTENTS.MENU_QR;
  return INTENTS.UNKNOWN;
}

function parseHours(question: string, fallback = 24) {
  const q = question.toLowerCase();
  if (/\b(this month|month to date|mtd)\b/.test(q)) return MONTH_HOURS;
  if (/\b(7d|7 days|last week)\b/.test(q)) return 168;
  if (/\btoday\b/.test(q)) return 24;
  return Number(fallback) || 24;
}

function missingResponse(intent: string, title: string, message: string) {
  return {
    answerType: "missing_data",
    title,
    directAnswer: message,
    keyMetrics: [],
    insights: [],
    recommendations: [],
    sources: [],
    warnings: [],
    missingData: [{ intent, label: title }],
    confidence: "none",
    exportOptions: [],
    isAiGenerated: false,
    diagnostics: null,
  };
}

async function rpcReviewSummary(
  supabase: ReturnType<typeof createClient>,
  branch: string | null,
  hours: number,
) {
  const { data, error } = await supabase.rpc("get_review_events_summary", {
    p_branch: branch,
    p_hours: hours,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    reviewQr: Number(row?.qr_scans) || 0,
    googleRedirects: Number(row?.google_redirects) || 0,
    staff: Array.isArray(row?.staff) ? row.staff.slice(0, MAX_ROWS) : [],
    byBranch: Array.isArray(row?.by_branch) ? row.by_branch.slice(0, MAX_ROWS) : [],
    row,
  };
}

async function rpcBranchComparison(supabase: ReturnType<typeof createClient>, hours: number) {
  const useRollup = hours >= 168 || hours === MONTH_HOURS;
  const rpc = useRollup ? "get_branch_comparison_from_rollup" : "get_branch_comparison";
  const { data, error } = await supabase.rpc(rpc, { p_hours: hours });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).slice(0, MAX_ROWS);
}

function buildDeterministic(
  intent: string,
  tool: Record<string, unknown>,
  periodLabel: string,
  branchLabel: string,
) {
  switch (intent) {
    case INTENTS.MENU_QR:
      return buildMenuMetricAnswerFields(tool as Parameters<typeof buildMenuMetricAnswerFields>[0], {
        label: "Menu QR Scans",
        value: Number(tool.qr) || 0,
        metricSource: "menu_events.funnel.qr_scans",
        periodLabel,
        branchLabel,
      });
    case INTENTS.MENU_SESSIONS:
      return buildMenuMetricAnswerFields(tool as Parameters<typeof buildMenuMetricAnswerFields>[0], {
        label: "Menu Sessions",
        value: Number(tool.sessions) || 0,
        metricSource: "menu_events canonical sessions",
        periodLabel,
        branchLabel,
      });
    case INTENTS.GOOGLE_REDIRECTS:
      return {
        answerType: "metric",
        title: `Google Redirects · ${periodLabel}`,
        directAnswer: `${Number(tool.googleRedirects).toLocaleString()} Google redirects for ${branchLabel} (${periodLabel}).`,
        keyMetrics: [{ label: "Google Redirects", value: Number(tool.googleRedirects) || 0, source: "review_events" }],
        insights: ["Redirects are intent to review — not published Google reviews."],
        recommendations: [],
        sources: [{ name: "get_review_events_summary", detail: "verified RPC" }],
        warnings: [],
        missingData: [],
        confidence: "high",
        exportOptions: [],
        isAiGenerated: false,
        diagnostics: { source: "live", includesCurrentBusinessDay: true, partialLive: false, warnings: [] },
      };
    case INTENTS.REVIEW_QR:
      return {
        answerType: "metric",
        title: `Review QR Scans · ${periodLabel}`,
        directAnswer: `${Number(tool.reviewQr).toLocaleString()} review QR scans for ${branchLabel} (${periodLabel}).`,
        keyMetrics: [{ label: "Review QR Scans", value: Number(tool.reviewQr) || 0, source: "review_events" }],
        insights: [],
        recommendations: [],
        sources: [{ name: "get_review_events_summary", detail: "verified RPC" }],
        warnings: [],
        missingData: [],
        confidence: "high",
        exportOptions: [],
        isAiGenerated: false,
        diagnostics: { source: "live", includesCurrentBusinessDay: true, partialLive: false, warnings: [] },
      };
    case INTENTS.STAFF_LEADERBOARD: {
      const staff = (tool.staff as Array<Record<string, unknown>>) || [];
      const rows = staff
        .map((s) => ({
          name: s.name,
          google: Number(s.google) || 0,
          scans: Number(s.scans) || 0,
        }))
        .filter((s) => s.google > 0 || s.scans > 0)
        .sort((a, b) => b.google - a.google)
        .slice(0, MAX_ROWS);
      const top = rows[0];
      return {
        answerType: "leaderboard",
        title: `Staff redirect leaderboard · ${periodLabel}`,
        directAnswer: top
          ? `${top.name} leads with ${top.google} Google redirects (${periodLabel}).`
          : `No staff-attributed redirects in ${periodLabel}.`,
        keyMetrics: rows.slice(0, 5).map((r, i) => ({
          label: `#${i + 1} ${r.name}`,
          value: r.google,
          unit: "redirects",
        })),
        insights: [],
        recommendations: [],
        sources: [{ name: "get_review_events_summary.staff", detail: "verified RPC" }],
        warnings: [],
        missingData: [],
        confidence: top ? "high" : "low",
        exportOptions: [],
        isAiGenerated: false,
        diagnostics: null,
      };
    }
    case INTENTS.BRANCH_COMPARE: {
      const rows = (tool.rows as Array<Record<string, unknown>>) || [];
      const top = rows[0];
      return {
        answerType: "comparison",
        title: `Branch comparison · ${periodLabel}`,
        directAnswer: top
          ? `${top.branch_id} leads with ${Number(top.sessions) || 0} menu sessions (${periodLabel}).`
          : `No branch rows for ${periodLabel}.`,
        keyMetrics: rows.slice(0, 6).map((r) => ({
          label: String(r.branch_id),
          value: Number(r.sessions) || 0,
          unit: "sessions",
        })),
        insights: [],
        recommendations: [],
        sources: [{ name: "get_branch_comparison_from_rollup", detail: "verified RPC" }],
        warnings: [],
        missingData: [],
        confidence: top ? "high" : "low",
        exportOptions: [],
        isAiGenerated: false,
        diagnostics: { source: "rollup", includesCurrentBusinessDay: false, partialLive: false, warnings: [] },
      };
    }
    default:
      return {
        answerType: "unknown",
        title: "Need a clearer metric question",
        directAnswer:
          "Try menu QR scans, sessions, Google redirects, review QR, staff leaderboard, or branch comparison.",
        keyMetrics: [],
        insights: [],
        recommendations: [],
        sources: [],
        warnings: [],
        missingData: [],
        confidence: "none",
        exportOptions: [],
        isAiGenerated: false,
        diagnostics: null,
      };
  }
}

async function maybeExplainWithOpenAi(deterministic: Record<string, unknown>, facts: unknown) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { ...deterministic, serverConnected: true };

  const prompt = `You are Ask NAC. Explain ONLY these verified facts in 2-3 sentences. Do not invent numbers.\nFacts: ${JSON.stringify(facts)}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "Answer only from provided structured facts. Never guess metrics." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    return {
      ...deterministic,
      serverConnected: true,
      warnings: [
        ...((deterministic.warnings as string[]) || []),
        "OpenAI explanation failed — showing verified facts only.",
      ],
    };
  }

  const payload = await res.json();
  const text = payload?.choices?.[0]?.message?.content?.trim();
  if (!text) return { ...deterministic, serverConnected: true };

  return {
    ...deterministic,
    directAnswer: text,
    isAiGenerated: true,
    serverConnected: true,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json(401, { error: "Missing Authorization header" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return json(500, { error: "Supabase env not configured" });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "Invalid or expired session" });
    }

    const body = await req.json();
    const question = String(body?.question || "").trim();
    if (!question) {
      return json(400, { error: "question is required" });
    }

    const hours = parseHours(question, body?.hours ?? 24);
    const branch = body?.branch ?? null;
    const branchLabel = branch || "Network (all branches)";
    const periodLabel = hours === MONTH_HOURS ? "Month-to-date" : hours === 168 ? "Last 7 days" : "Today";

    const intent = routeIntent(question);

    if (intent === INTENTS.AVG_SPEND) {
      return json(200, missingResponse(intent, "Average spend per guest", "Guest-count schema not enabled yet."));
    }
    if (intent === INTENTS.DELIVERY) {
      return json(200, missingResponse(intent, "Delivery platform sales", "Delivery parsing not implemented yet."));
    }
    if (intent === INTENTS.GOOGLE_REVIEWS) {
      return json(
        200,
        missingResponse(intent, "Actual Google reviews", "Requires google_review_snapshots — not wired in Edge yet."),
      );
    }
    if (
      intent === INTENTS.FOODICS ||
      intent === INTENTS.FOODICS_SALES_TOTAL ||
      intent === INTENTS.FOODICS_TOP_ITEMS ||
      intent === INTENTS.FOODICS_TOP_COMPARE ||
      intent === INTENTS.FOODICS_RANK_CHANGE ||
      intent === INTENTS.FOODICS_CATEGORY ||
      intent === INTENTS.FOODICS_BRANCH_SALES
    ) {
      return json(200, {
        ...missingResponse(
          intent,
          "Foodics sales intelligence",
          "Server Foodics not wired yet — use local Ask NAC fallback in the dashboard for uploaded Foodics batches.",
        ),
        useLocalFallback: true,
        serverConnected: true,
      });
    }
    if (intent === INTENTS.UNKNOWN) {
      return json(200, buildDeterministic(INTENTS.UNKNOWN, {}, periodLabel, branchLabel));
    }

    let tool: Record<string, unknown> = {};
    if (intent === INTENTS.MENU_QR || intent === INTENTS.MENU_SESSIONS) {
      tool = await fetchAskNacMenuMetrics(supabase, { branch, hours });
    } else if (
      intent === INTENTS.GOOGLE_REDIRECTS ||
      intent === INTENTS.REVIEW_QR ||
      intent === INTENTS.STAFF_LEADERBOARD
    ) {
      tool = await rpcReviewSummary(supabase, branch, hours);
    } else if (intent === INTENTS.BRANCH_COMPARE) {
      tool = { rows: await rpcBranchComparison(supabase, hours) };
    }

    const deterministic = buildDeterministic(intent, tool, periodLabel, branchLabel);
    deterministic.intent = intent;

    const answered = await maybeExplainWithOpenAi(deterministic, {
      intent,
      tool,
      hours,
      branch,
      diagnostics: tool.mtdHybrid || null,
    });

    console.info(
      JSON.stringify({
        fn: "ask-nac",
        user: userData.user.id,
        intent,
        hours,
        branch: branch || "network",
        ai: answered.isAiGenerated,
        mtdSource: (tool.mtdHybrid as Record<string, unknown>)?.source || tool.dataSource || null,
        partialLive: (tool.mtdHybrid as Record<string, unknown>)?.partialLive || false,
      }),
    );

    return json(200, answered);
  } catch (err) {
    console.error("[ask-nac]", (err as Error)?.message || err);
    return json(500, { error: (err as Error)?.message || "Internal error" });
  }
});
