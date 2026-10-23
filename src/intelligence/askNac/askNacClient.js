/**
 * Ask NAC client — Edge Function when configured, deterministic local fallback otherwise.
 * Never exposes OpenAI keys in the browser.
 */

import { supabase as defaultSupabase } from "../../lib/supabase";
import { fetchWithDeadline } from "../../lib/fetchDeadline";
import { processAskNacQuestion } from "./askNacOrchestrator";
import { createAskNacResponse, ANSWER_TYPES, CONFIDENCE_LEVELS } from "./askNacContract";
import { ASK_NAC_INTENTS, routeAskNacIntent } from "./intentRouter";
import { requiresStructuredOperationalRetrieval } from "./vault/vaultMonthlyOperationalSummaryRouting";
import { prepareAskNacQuestion } from "./conversation/prepareAskNacQuestion";

/**
 * Intents the server hands to the client (explicit hand-off), or that an older
 * deployed server cannot route (it answers "unknown"). For these the client runs
 * its own read-only tool and labels the answer localFallback (Oracle T3).
 */
export const CLIENT_EXECUTED_INTENTS = Object.freeze([ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION]);

export function serverAnswerShouldYieldToLocal(question, payload, conversationContext) {
  const prepared = prepareAskNacQuestion({ question, conversationContext, filters: {} });
  const local = routeAskNacIntent(prepared.effectiveQuestion);
  const serverIntent = String(payload?.intent || "");
  const text = String(payload?.directAnswer || "");
  if (/could not parse a calendar|vault period missing|no vault period/i.test(text)) return true;
  if (serverOperationalAnswerNeedsStructuredRetry(prepared.effectiveQuestion, payload)) return true;
  const localPreferred = local.intent === "vault_operational_review" || local.intent === "top_items" || local.intent === "top_items_compare";
  if (localPreferred && serverIntent && serverIntent !== local.intent) return true;
  if (local.intent === "top_items" && /highest sales day|best sales day|sales day/i.test(text)) return true;
  if (local.intent === "vault_operational_review" && /\bSAR\b/.test(text) && !/\b(complaint|maintenance|staff|incident)\b/i.test(text)) return true;
  return false;
}

export function serverOperationalAnswerNeedsStructuredRetry(question, payload) {
  if (!requiresStructuredOperationalRetrieval(question)) return false;
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  const citesFacts = sources.some((source) => /structured_facts|get_vault_logbook_month_summary_facts/i.test(String(source?.name || "")));
  const text = [
    payload?.directAnswer,
    ...(payload?.recommendations || []),
    ...(payload?.insights || []),
  ].join("\n");
  const falseZero = /no complaints were recorded|no guest complaints occurred|upload or re-index|re-upload logbook|upload daily logbooks/i.test(text);
  if (citesFacts && !falseZero) return false;
  const citesChunks = sources.some((source) => /document_chunks/i.test(String(source?.name || "")));
  return citesChunks || falseZero || /document_no_match|no_match/.test(String(payload?.answerType || ""));
}

export function serverAnswerNeedsLocalExecution(payload, question) {
  const handoff = payload?.handoff;
  if (handoff?.kind === "client_local_tool" && CLIENT_EXECUTED_INTENTS.includes(handoff.intent)) {
    return { reason: "handoff", intent: handoff.intent };
  }
  if (!payload?.intent || payload.intent === ASK_NAC_INTENTS.UNKNOWN) {
    const local = routeAskNacIntent(question);
    if (CLIENT_EXECUTED_INTENTS.includes(local?.intent)) {
      return { reason: "server_unknown", intent: local.intent };
    }
  }
  return null;
}

const ASK_NAC_FUNCTION = "ask-nac";

/** Derive Edge Function URL from Supabase project URL unless overridden. */
export function resolveAskNacEdgeUrl() {
  const explicit = process.env.REACT_APP_ASK_NAC_FUNCTION_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const base = process.env.REACT_APP_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/functions/v1/${ASK_NAC_FUNCTION}`;
}

export function isAskNacServerConfigured() {
  return Boolean(resolveAskNacEdgeUrl());
}

function buildProfileHint(profile) {
  if (!profile) return null;
  return {
    authenticated: Boolean(profile.authenticated),
    allBranches: Boolean(profile.allBranches),
    branchScope: profile.branchScope ?? null,
  };
}

/**
 * @param {object} params
 * @param {string} params.question
 * @param {object} [params.supabase]
 * @param {object} [params.session] Supabase auth session (access_token for Edge Function)
 * @param {object} [params.profile]
 * @param {object} [params.filters]
 * @param {boolean} [params.preferServer] default true when URL configured
 */
export async function askNac({
  question,
  supabase = defaultSupabase,
  session = null,
  profile = null,
  filters = {},
  conversationContext = null,
  preferServer = true,
}) {
  const edgeUrl = resolveAskNacEdgeUrl();
  const serverConfigured = Boolean(edgeUrl);

  if (preferServer && serverConfigured && session?.access_token) {
    try {
      const res = await fetchWithDeadline(edgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY || "",
        },
        body: JSON.stringify({
          question,
          conversationContext,
          branch: filters.branch ?? null,
          hours: filters.timeRangeHours ?? 24,
          range: filters.selectedRange ?? null,
          profileHint: buildProfileHint(profile),
          filters,
        }),
      }, 20000);

      if (res.ok) {
        const payload = await res.json();
        if (serverAnswerShouldYieldToLocal(question, payload, conversationContext) && supabase) {
          const local = await processAskNacQuestion({
            question,
            supabase,
            profile,
            filters,
            conversationContext,
            session,
          });
          return {
            ...local,
            serverConnected: true,
            localFallback: true,
            aiConnected: false,
            warnings: [
              ...(local.warnings || []),
              "Structured logbook facts were read in the browser because the Ask NAC server did not return recovered narrative evidence.",
            ],
          };
        }
        const runLocally = serverAnswerNeedsLocalExecution(payload, question);
        if (runLocally) {
          const local = await processAskNacQuestion({
            question,
            supabase,
            profile,
            filters,
            conversationContext,
            session,
          });
          return {
            ...local,
            serverConnected: true,
            localFallback: true,
            aiConnected: false,
            warnings: [
              ...(local.warnings || []),
              runLocally.reason === "handoff"
                ? "Computed on this device by the Inventory Truth recipe engine (server hand-off)."
                : "The Ask NAC server could not route this question; computed on this device instead.",
            ],
          };
        }
        return {
          ...payload,
          serverConnected: payload.serverConnected !== false,
          localFallback: payload.localFallback === true,
          aiConnected: payload.aiConnected === true,
        };
      }

      const errText = await res.text().catch(() => "");
      const local = await processAskNacQuestion({
        question,
        supabase,
        profile,
        filters,
        conversationContext,
        session,
      });
      return {
        ...local,
        serverConnected: false,
        localFallback: true,
        aiConnected: false,
        warnings: [
          ...(local.warnings || []),
          `Ask NAC server returned ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ""} — using local verified fallback.`,
        ],
      };
    } catch (err) {
      const local = await processAskNacQuestion({
        question,
        supabase,
        profile,
        filters,
        conversationContext,
        session,
      });
      return {
        ...local,
        serverConnected: false,
        localFallback: true,
        aiConnected: false,
        warnings: [
          ...(local.warnings || []),
          `Ask NAC server unreachable (${err?.message || "network"}) — using local verified fallback.`,
        ],
      };
    }
  }

  if (!supabase) {
    return createAskNacResponse({
      answerType: ANSWER_TYPES.ERROR,
      title: "Supabase not configured",
      directAnswer: "Connect Supabase to query verified NAC Intelligence metrics.",
      confidence: CONFIDENCE_LEVELS.NONE,
      serverConnected: false,
      localFallback: true,
      aiConnected: false,
      warnings: serverConfigured
        ? ["Server endpoint configured but sign in required for remote Ask NAC."]
        : ["Server not connected — configure REACT_APP_SUPABASE_URL and deploy ask-nac Edge Function."],
    });
  }

  const local = await processAskNacQuestion({
    question,
    supabase,
    profile,
    filters,
    conversationContext,
    session,
  });
  return {
    ...local,
    serverConnected: false,
    localFallback: true,
    aiConnected: false,
    warnings: [
      ...(local.warnings || []),
      ...(serverConfigured && !session?.access_token
        ? ["Sign in to use the Ask NAC Edge Function; showing local verified answers."]
        : !serverConfigured
          ? ["Server not connected — deterministic local answers only."]
          : []),
    ].filter(Boolean),
  };
}
