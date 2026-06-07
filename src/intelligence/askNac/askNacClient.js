/**
 * Ask NAC client — Edge Function when configured, deterministic local fallback otherwise.
 * Never exposes OpenAI keys in the browser.
 */

import { supabase as defaultSupabase } from "../../lib/supabase";
import { processAskNacQuestion } from "./askNacOrchestrator";
import { createAskNacResponse, ANSWER_TYPES, CONFIDENCE_LEVELS } from "./askNacContract";
import { routeAskNacIntent, isFoodicsDataIntent, ASK_NAC_INTENTS } from "./intentRouter";

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
  preferServer = true,
}) {
  const edgeUrl = resolveAskNacEdgeUrl();
  const serverConfigured = Boolean(edgeUrl);
  const fallbackHours = filters.timeRangeHours ?? 24;
  const preRoute = routeAskNacIntent(question, { fallbackHours });

  if (isFoodicsDataIntent(preRoute.intent) && preRoute.intent !== ASK_NAC_INTENTS.FOODICS_QUERY) {
    const local = await processAskNacQuestion({ question, supabase, profile, filters });
    return {
      ...local,
      serverConnected: false,
      warnings: [
        ...(local.warnings || []),
        serverConfigured
          ? "Foodics queries run locally — server Foodics not wired yet on Edge."
          : null,
      ].filter(Boolean),
    };
  }

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
          branch: filters.branch ?? null,
          hours: filters.timeRangeHours ?? 24,
          range: filters.selectedRange ?? null,
        }),
      });

      if (res.ok) {
        const payload = await res.json();
        return {
          ...payload,
          serverConnected: true,
        };
      }

      const errText = await res.text().catch(() => "");
      return processAskNacQuestion({
        question,
        supabase,
        profile,
        filters,
      }).then((local) => ({
        ...local,
        serverConnected: false,
        warnings: [
          ...(local.warnings || []),
          `Ask NAC server returned ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ""} — using local verified fallback.`,
        ],
      }));
    } catch (err) {
      const local = await processAskNacQuestion({ question, supabase, profile, filters });
      return {
        ...local,
        serverConnected: false,
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
      warnings: serverConfigured
        ? ["Server AI endpoint configured but sign in required for remote Ask NAC."]
        : ["Server AI not connected — configure REACT_APP_SUPABASE_URL and deploy ask-nac Edge Function."],
    });
  }

  const local = await processAskNacQuestion({ question, supabase, profile, filters });
  return {
    ...local,
    serverConnected: false,
    warnings: [
      ...(local.warnings || []),
      ...(serverConfigured && !session?.access_token
        ? ["Sign in to use the Ask NAC Edge Function; showing local verified answers."]
        : !serverConfigured
          ? ["Server AI not connected — deterministic local answers only."]
          : []),
    ].filter(Boolean),
  };
}
