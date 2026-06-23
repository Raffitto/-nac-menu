/**
 * Ask NAC Edge Function — thin auth handler delegating to processAskNacOnEdge.
 * Deploy: supabase functions deploy ask-nac
 * Secrets: OPENAI_API_KEY (optional), SUPABASE_URL, SUPABASE_ANON_KEY (auto in Edge)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { processAskNacOnEdge } from "../_shared/askNacOrchestrator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const answered = await processAskNacOnEdge(supabase, {
      question,
      conversationContext: body?.conversationContext ?? null,
      branch: body?.branch ?? null,
      hours: body?.hours,
      range: body?.range,
      profileHint: body?.profileHint ?? body?.profile ?? null,
      filters: body?.filters ?? {},
      userEmail: userData.user.email ?? null,
    });

    const includeCashUpTrace = Deno.env.get("ASK_NAC_CASHUP_TRACE") === "true";
    const responsePayload: Record<string, unknown> = { ...answered };
    if (!includeCashUpTrace) {
      delete responsePayload.cashUpProductionTrace;
      delete responsePayload.cashUpDebug;
    }

    const trace = answered.cashUpProductionTrace as { failurePoint?: string | null } | undefined;
    console.info(
      JSON.stringify({
        fn: "ask-nac",
        user: userData.user.id,
        intent: answered.intent,
        branch: body?.branch || "network",
        ai: answered.isAiGenerated,
        aiConnected: answered.aiConnected,
        cashUpFailurePoint: trace?.failurePoint ?? null,
      }),
    );

    return json(200, responsePayload);
  } catch (err) {
    console.error("[ask-nac]", (err as Error)?.message || err);
    return json(500, { error: (err as Error)?.message || "Internal error" });
  }
});
