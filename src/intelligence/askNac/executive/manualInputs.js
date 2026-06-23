/**
 * Period-specific manual inputs (one reporting period only).
 */

const INPUT_SELECT = "id, branch_id, report_type, metric_key, metric_label, metric_value, metric_text, period_start, period_end, period_label, provided_by";

export async function upsertManualInput(
  supabase,
  {
    branch,
    reportType = "weekly_dashboard",
    metricKey,
    metricLabel,
    metricValue,
    metricText,
    periodStart,
    periodEnd,
    periodLabel,
    pendingSessionId,
    providedBy,
  } = {},
) {
  const row = {
    branch_id: branch,
    report_type: reportType,
    metric_key: metricKey,
    metric_label: metricLabel || metricKey,
    metric_value: metricValue ?? null,
    metric_text: metricText ?? (metricValue != null ? String(metricValue) : null),
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

  return {
    input: {
      id: data.id,
      branchId: data.branch_id,
      reportType: data.report_type,
      metricKey: data.metric_key,
      metricLabel: data.metric_label,
      metricValue: data.metric_value,
      periodStart: data.period_start,
      periodEnd: data.period_end,
      periodLabel: data.period_label,
      source: "manual_input",
    },
    sources: [{ name: "ask_nac_manual_inputs", detail: `${metricLabel || metricKey} for ${periodLabel || periodStart}` }],
  };
}

export async function fetchManualInputsForPeriod(
  supabase,
  { branch, reportType = "weekly_dashboard", periodStart, periodEnd } = {},
) {
  const { data, error } = await supabase
    .from("ask_nac_manual_inputs")
    .select(INPUT_SELECT)
    .eq("branch_id", branch)
    .eq("report_type", reportType)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd);

  if (error) {
    return { inputs: [], sources: [], warning: error.message };
  }

  const inputs = (data || []).map((row) => ({
    id: row.id,
    metricKey: row.metric_key,
    metricLabel: row.metric_label,
    metricValue: row.metric_value,
    metricText: row.metric_text,
    source: "manual_input",
  }));

  return {
    inputs,
    sources: [{ name: "ask_nac_manual_inputs", detail: `${inputs.length} manual value(s) for period` }],
  };
}
