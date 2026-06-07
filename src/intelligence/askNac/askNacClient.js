/**
 * Ask NAC client — Edge Function when configured, deterministic local fallback otherwise.
 * Never exposes OpenAI keys in the browser.
 */

import { supabase as defaultSupabase } from "../../lib/supabase";
import { processAskNacQuestion } from "./askNacOrchestrator";
import { createAskNacResponse, ANSWER_TYPES, CONFIDENCE_LEVELS } from "./askNacContract";

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
      const res = await fetch(edgeUrl, {
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
      });

      if (res.ok) {
        const payload = await res.json();
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
