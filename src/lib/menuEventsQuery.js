/**
 * Defensive menu_events queries — retries without employee_role if column not migrated yet.
 */

export const MENU_EVENTS_EXTENDED_SELECT =
  "session_id, language, event_type, category_id, section_id, item_name_en, add_on_name, created_at, metadata, branch_id";

export const MENU_EVENTS_FEED_SELECT =
  "id, created_at, event_type, language, category_id, item_name_en, item_name_ar, search_query, add_on_name, branch_id, metadata";

const ROLE_COL = "employee_role";

export function isMissingEmployeeRoleColumn(error) {
  if (!error) return false;
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return msg.includes(ROLE_COL) && (msg.includes("does not exist") || msg.includes("column"));
}

/** Resolve role from row column or metadata (pre-migration / legacy rows). */
export function rowEmployeeRole(row) {
  if (!row) return null;
  if (row.employee_role) return row.employee_role;
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return meta.employee_role || meta.role || null;
}

export function enrichMenuEventRow(row) {
  if (!row || typeof row !== "object") return row;
  const role = rowEmployeeRole(row);
  return role ? { ...row, employee_role: role } : row;
}

export function enrichMenuEventRows(rows) {
  return (rows || []).map(enrichMenuEventRow);
}

/**
 * Run a menu_events select; falls back if employee_role column is missing.
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} baseSelect - columns without employee_role
 * @param {(q: import('@supabase/supabase-js').PostgrestFilterBuilder) => import('@supabase/supabase-js').PostgrestFilterBuilder} applyFilters
 */
export async function queryMenuEvents(client, baseSelect, applyFilters) {
  const run = (withRole) => {
    const select = withRole ? `${baseSelect},${ROLE_COL}` : baseSelect;
    let q = client.from("menu_events").select(select);
    if (typeof applyFilters === "function") q = applyFilters(q);
    return q;
  };

  let result = await run(true);
  if (isMissingEmployeeRoleColumn(result.error)) {
    result = await run(false);
  }
  if (result.data) {
    result = { ...result, data: enrichMenuEventRows(result.data) };
  }
  return result;
}
