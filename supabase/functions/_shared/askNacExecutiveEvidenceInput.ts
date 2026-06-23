/**
 * Edge — store executive evidence manual inputs.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacFoodicsTools.ts";

async function upsertManualInput(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("ask_nac_manual_inputs")
    .upsert(payload, { onConflict: "branch_id,report_type,metric_key,period_start,period_end" })
    .select("id, metric_key, metric_label, metric_value, metric_text")
    .single();
  if (error) throw new Error(error.message);
  return {
    input: {
      metricKey: data.metric_key,
      metricLabel: data.metric_label,
      metricValue: data.metric_value,
      metricText: data.metric_text,
      source: "manual_input",
    },
    sources: [{ name: "ask_nac_manual_inputs", detail: `${data.metric_label} stored` }],
  };
}

async function updatePendingSession(
  supabase: SupabaseClient,
  sessionId: string,
  patch: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("ask_nac_pending_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function storeExecutiveEvidenceManualInput(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const branch = context.branch as string;
  const userEmail = context.userEmail as string;
  const manualInput = context.manualInput as Record<string, unknown>;
  const pendingSession = context.pendingSession as Record<string, unknown>;
  const vaultPeriod = (context.vaultPeriod || pendingSession?.context) as Record<string, unknown> || {};
  const periodStart = vaultPeriod.startDate as string;
  const periodEnd = vaultPeriod.endDate as string;
  const periodLabel = String(vaultPeriod.periodLabel || vaultPeriod.label || "this period");

  const stored = await upsertManualInput(supabase, {
    branch_id: branch,
    report_type: "executive_evidence",
    metric_key: manualInput.metricKey,
    metric_label: manualInput.metricLabel,
    metric_value: manualInput.metricValue ?? null,
    metric_text: manualInput.metricText || (manualInput.metricValue != null ? String(manualInput.metricValue) : null),
    period_start: periodStart,
    period_end: periodEnd,
    period_label: periodLabel,
    pending_session_id: pendingSession?.id || null,
    provided_by: userEmail,
  });

  const missingFields = (pendingSession?.missingFields as Array<Record<string, unknown>>) || [];
  const remainingFields = missingFields.filter((field) => (field.key || field.metric_key) !== manualInput.metricKey);
  const updatedSession = await updatePendingSession(supabase, String(pendingSession?.id), {
    provided_inputs: { ...(pendingSession?.providedInputs as Record<string, unknown> || {}), [String(manualInput.metricKey)]: manualInput.metricValue ?? manualInput.metricText },
    missing_fields: remainingFields,
    status: remainingFields.length ? "pending" : "complete",
  });

  let operatorMemory = null;
  if (manualInput.metricText && manualInput.metricValue == null && String(manualInput.metricText).length > 12) {
    const { data } = await supabase.from("ask_nac_operator_memory").insert({
      branch_id: branch || null,
      category: "executive_context",
      fact: `${manualInput.metricLabel}: ${manualInput.metricText}`,
      taught_by: userEmail,
      active: true,
    }).select("id, fact").single();
    operatorMemory = data;
  }

  return {
    branch,
    branchLabel: context.branchLabel || branchDisplayName(branch),
    storedInput: stored.input,
    pendingSession: updatedSession,
    missingFields: remainingFields,
    sources: stored.sources,
    operatorMemory,
    learnNote: operatorMemory
      ? "Stored as period-specific manual input and permanent operator memory."
      : "Stored as period-specific manual input for this reporting period only.",
  };
}
