/**
 * Atomic structured-facts replacement via Postgres RPC (insert → validate → delete old).
 */

export async function replaceStructuredFactsForFile(
  admin,
  {
    fileId,
    rows,
    periodStart,
    periodEnd,
    minInserted,
  },
) {
  if (!fileId) throw new Error("Structured facts replace requires file_id.");
  if (!rows?.length) throw new Error("Structured facts replace requires at least one fact row.");

  const payload = rows.map((row) => ({
    file_version_id: row.file_version_id ?? null,
    branch_id: row.branch_id ?? null,
    brand_wide: row.brand_wide ?? false,
    department: row.department,
    report_type: row.report_type,
    sensitivity_level: row.sensitivity_level,
    metric_key: row.metric_key,
    metric_value: row.metric_value ?? null,
    metric_unit: row.metric_unit ?? null,
    dimensions: row.dimensions ?? {},
    period_start: row.period_start ?? null,
    period_end: row.period_end ?? null,
    grain: row.grain ?? "daily",
    source_row_ref: row.source_row_ref ?? null,
    confidence: row.confidence ?? null,
    created_by: row.created_by ?? null,
  }));

  const { data, error } = await admin.rpc("replace_ask_nac_file_structured_facts", {
    p_file_id: fileId,
    p_facts: payload,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_min_inserted: minInserted ?? rows.length,
  });

  if (error) throw new Error(error.message);

  return {
    inserted: Number(data?.inserted ?? 0),
    deleted: Number(data?.deleted ?? 0),
  };
}
