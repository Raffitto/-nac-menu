/**
 * Ask NAC Edge Function — thin auth handler delegating to processAskNacOnEdge.
 * Deploy: supabase functions deploy ask-nac
 * Secrets: OPENAI_API_KEY (optional), SUPABASE_URL, SUPABASE_ANON_KEY (auto in Edge)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { processAskNacOnEdge } from "../_shared/askNacOrchestrator.ts";
import { loadAskNacAuthProfileHint } from "../_shared/askNacAuthProfile.ts";

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

    const requestedBranch = body?.branch ?? body?.filters?.branch ?? null;
    if (requestedBranch != null && String(requestedBranch).trim()) {
      const { data: branchAllowed, error: branchAuthError } = await supabase.rpc(
        "ask_nac_vault_branch_allowed",
        { p_branch: String(requestedBranch) },
      );
      if (branchAuthError) {
        console.error("[ask-nac] branch authorization failed", branchAuthError.message);
        return json(500, { error: "Unable to verify branch access" });
      }
      if (!branchAllowed) {
        return json(403, {
          error: "Branch access denied",
          branch: String(requestedBranch),
        });
      }
    }

    const clientProfileHint = body?.profileHint ?? body?.profile ?? null;
    const authProfile = await loadAskNacAuthProfileHint(supabase, clientProfileHint);
    const answered = await processAskNacOnEdge(supabase, {
      question,
      conversationContext: body?.conversationContext ?? null,
      branch: body?.branch ?? null,
      hours: body?.hours,
      range: body?.range,
      profileHint: authProfile.profileHint,
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
    const scopeDiag = {
      role: authProfile.diagnostics.vaultRole || authProfile.profileHint.role || null,
      allBranches: authProfile.diagnostics.allBranches,
      primaryBranchId: authProfile.diagnostics.primaryBranchId,
      allowedBranchIds: authProfile.diagnostics.allowedBranchIds,
      clientBranchScope: authProfile.diagnostics.clientBranchScope,
      clientAllBranches: authProfile.diagnostics.clientAllBranches,
      source: authProfile.diagnostics.source,
      resolvedBranchLabel: (answered as { branchLabel?: string | null }).branchLabel ?? null,
      feasibility: (answered as { companyIntelligence?: { feasibility?: string | null } }).companyIntelligence?.feasibility ?? null,
    };
    const ci = (responsePayload.companyIntelligence as Record<string, unknown> | undefined) || {};
    responsePayload.companyIntelligence = {
      ...ci,
      scopeDiagnostics: scopeDiag,
    };
    console.info(
      JSON.stringify({
        fn: "ask-nac",
        user: String(userData.user.id || "").slice(0, 8),
        intent: answered.intent,
        branch: body?.branch || "network",
        ai: answered.isAiGenerated,
        aiConnected: answered.aiConnected,
        cashUpFailurePoint: trace?.failurePoint ?? null,
        scope: scopeDiag,
      }),
    );

    return json(200, responsePayload);
  } catch (err) {
    console.error("[ask-nac]", (err as Error)?.message || err);
    return json(500, { error: (err as Error)?.message || "Internal error" });
  }
});
