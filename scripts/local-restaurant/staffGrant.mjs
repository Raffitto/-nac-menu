/** Pick a staff grant from the database. Client role and branch claims are ignored unless a matching grant exists. */

export function selectStaffGrant(grants, requestedBranch) {
  const rows = (Array.isArray(grants) ? grants : []).filter((row) => row?.branch_id && row.branch_id !== "*");
  if (!rows.length) return { ok: false, reason: "branch_forbidden" };
  const requested = String(requestedBranch || "").trim().toLowerCase();
  if (requested) {
    const match = rows.find((row) => String(row.branch_id).toLowerCase() === requested);
    if (!match) return { ok: false, reason: "branch_forbidden" };
    return { ok: true, role: match.role, branchId: match.branch_id };
  }
  const branches = [...new Set(rows.map((row) => row.branch_id))];
  if (branches.length > 1) return { ok: false, reason: "branch_required" };
  return { ok: true, role: rows[0].role, branchId: rows[0].branch_id };
}
