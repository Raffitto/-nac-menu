/**
 * Structured-facts replacement for Drive/manual ingestion.
 * Small payloads use the Postgres RPC (insert → validate → delete old).
 * Large cash-up workbooks batch-insert by file_version_id, then delete prior
 * versions so Edge/PostgREST are not blocked on one multi‑MB RPC body.
 */

type SupabaseClientLike = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => any;
};

export type ReplaceStructuredFactsResult = {
  inserted: number;
  deleted: number;
};

/** Keep each PostgREST body comfortably under Edge/gateway limits. */
export const STRUCTURED_FACTS_RPC_BATCH_SIZE = 400;
export const STRUCTURED_FACTS_INSERT_BATCH_SIZE = 250;

function toPayload(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
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
}

async function replaceViaRpc(
  admin: SupabaseClientLike,
  {
    fileId,
    payload,
    periodStart,
    periodEnd,
    minInserted,
  }: {
    fileId: string;
    payload: Record<string, unknown>[];
    periodStart: string | null;
    periodEnd: string | null;
    minInserted: number;
  },
): Promise<ReplaceStructuredFactsResult> {
  const { data, error } = await admin.rpc("replace_ask_nac_file_structured_facts", {
    p_file_id: fileId,
    p_facts: payload,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_min_inserted: minInserted,
  });
  if (error) throw new Error(error.message);
  const result = (data || {}) as Record<string, unknown>;
  return {
    inserted: Number(result.inserted ?? 0),
    deleted: Number(result.deleted ?? 0),
  };
}

async function replaceViaVersionedBatches(
  admin: SupabaseClientLike,
  {
    fileId,
    payload,
    versionId,
    periodStart,
    periodEnd,
    minInserted,
    onBatch,
  }: {
    fileId: string;
    payload: Record<string, unknown>[];
    versionId: string;
    periodStart: string | null;
    periodEnd: string | null;
    minInserted: number;
    onBatch?: (info: { batchIndex: number; batchCount: number; insertedSoFar: number }) => Promise<void> | void;
  },
): Promise<ReplaceStructuredFactsResult> {
  let inserted = 0;
  const batchCount = Math.ceil(payload.length / STRUCTURED_FACTS_INSERT_BATCH_SIZE);

  try {
    for (let i = 0; i < payload.length; i += STRUCTURED_FACTS_INSERT_BATCH_SIZE) {
      const slice = payload.slice(i, i + STRUCTURED_FACTS_INSERT_BATCH_SIZE).map((row) => ({
        file_id: fileId,
        file_version_id: versionId,
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
      const { error } = await admin.from("ask_nac_structured_facts").insert(slice);
      if (error) throw new Error(error.message);
      inserted += slice.length;
      const batchIndex = Math.floor(i / STRUCTURED_FACTS_INSERT_BATCH_SIZE) + 1;
      if (onBatch) await onBatch({ batchIndex, batchCount, insertedSoFar: inserted });
    }

    if (inserted < minInserted) {
      throw new Error(`inserted fact count ${inserted} below minimum ${minInserted}`);
    }

    // Remove prior versions only after the new version fully inserted (parse-before-delete).
    const { error: delOtherError, count: deletedOther } = await admin
      .from("ask_nac_structured_facts")
      .delete({ count: "exact" })
      .eq("file_id", fileId)
      .neq("file_version_id", versionId);
    if (delOtherError) throw new Error(delOtherError.message);

    const { error: delNullError, count: deletedNull } = await admin
      .from("ask_nac_structured_facts")
      .delete({ count: "exact" })
      .eq("file_id", fileId)
      .is("file_version_id", null);
    if (delNullError) throw new Error(delNullError.message);

    if (periodStart && periodEnd) {
      const { error: fileError } = await admin
        .from("ask_nac_files")
        .update({
          period_start: periodStart,
          period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId);
      if (fileError) throw new Error(fileError.message);

      await admin
        .from("ask_nac_data_coverage")
        .update({
          period_start: periodStart,
          period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq("source_file_id", fileId);
    }

    return {
      inserted,
      deleted: Number(deletedOther || 0) + Number(deletedNull || 0),
    };
  } catch (err) {
    // Roll back only the new version rows; preserve prior facts.
    await admin
      .from("ask_nac_structured_facts")
      .delete()
      .eq("file_id", fileId)
      .eq("file_version_id", versionId);
    throw err;
  }
}

export async function replaceStructuredFactsForFile(
  admin: SupabaseClientLike,
  {
    fileId,
    rows,
    periodStart,
    periodEnd,
    minInserted,
    onBatch,
  }: {
    fileId: string;
    rows: Record<string, unknown>[];
    periodStart: string | null;
    periodEnd: string | null;
    minInserted?: number;
    onBatch?: (info: { batchIndex: number; batchCount: number; insertedSoFar: number }) => Promise<void> | void;
  },
): Promise<ReplaceStructuredFactsResult> {
  if (!fileId) throw new Error("Structured facts replace requires file_id.");
  if (!rows?.length) throw new Error("Structured facts replace requires at least one fact row.");

  const payload = toPayload(rows);
  const required = minInserted ?? rows.length;
  const versionId = payload[0]?.file_version_id ? String(payload[0].file_version_id) : null;
  const sameVersion = Boolean(
    versionId && payload.every((row) => String(row.file_version_id || "") === versionId),
  );

  if (payload.length <= STRUCTURED_FACTS_RPC_BATCH_SIZE || !sameVersion || !versionId) {
    return replaceViaRpc(admin, {
      fileId,
      payload,
      periodStart,
      periodEnd,
      minInserted: required,
    });
  }

  return replaceViaVersionedBatches(admin, {
    fileId,
    payload,
    versionId,
    periodStart,
    periodEnd,
    minInserted: required,
    onBatch,
  });
}
