/**
 * Pending Ask NAC sessions — unfinished workflows awaiting user input.
 */

import { WEEKLY_DASHBOARD_FIELD_DEFS } from "./manualInputParser";

const SESSION_SELECT = "id, branch_id, session_type, status, missing_fields, provided_inputs, context, created_by, expires_at, created_at, updated_at";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export async function fetchPendingSession(supabase, sessionId) {
  if (!sessionId) return null;
  const { data, error } = await supabase
    .from("ask_nac_pending_sessions")
    .select(SESSION_SELECT)
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return mapSessionRow(data);
}

export async function fetchActivePendingSession(
  supabase,
  { branch, createdBy, sessionType = "weekly_dashboard" } = {},
) {
  const { data, error } = await supabase
    .from("ask_nac_pending_sessions")
    .select(SESSION_SELECT)
    .eq("branch_id", branch)
    .eq("session_type", sessionType)
    .eq("status", "pending")
    .eq("created_by", createdBy)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapSessionRow(data);
}

export async function createPendingSession(
  supabase,
  {
    branch,
    sessionType = "weekly_dashboard",
    missingFields,
    context = {},
    createdBy,
  } = {},
) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const row = {
    branch_id: branch,
    session_type: sessionType,
    status: "pending",
    missing_fields: missingFields || WEEKLY_DASHBOARD_FIELD_DEFS,
    provided_inputs: {},
    context,
    created_by: createdBy,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("ask_nac_pending_sessions")
    .insert(row)
    .select(SESSION_SELECT)
    .single();

  if (error) throw new Error(error.message);
  return mapSessionRow(data);
}

export async function updatePendingSession(
  supabase,
  sessionId,
  { providedInputs, missingFields, status, context } = {},
) {
  const patch = { updated_at: new Date().toISOString() };
  if (providedInputs != null) patch.provided_inputs = providedInputs;
  if (missingFields != null) patch.missing_fields = missingFields;
  if (status != null) patch.status = status;
  if (context != null) patch.context = context;

  const { data, error } = await supabase
    .from("ask_nac_pending_sessions")
    .update(patch)
    .eq("id", sessionId)
    .select(SESSION_SELECT)
    .single();

  if (error) throw new Error(error.message);
  return mapSessionRow(data);
}

function mapSessionRow(row) {
  return {
    id: row.id,
    branchId: row.branch_id,
    sessionType: row.session_type,
    status: row.status,
    missingFields: row.missing_fields || [],
    providedInputs: row.provided_inputs || {},
    context: row.context || {},
    createdBy: row.created_by,
    expiresAt: row.expires_at,
  };
}
