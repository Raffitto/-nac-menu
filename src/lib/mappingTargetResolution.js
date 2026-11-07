/** Pure, read-only target validation. Inactive historical records are valid targets too. */
export function resolveMappingTarget(targetId, { menuItems = [], addons = [], targetKind } = {}) {
  const id = typeof targetId === "string" ? targetId.trim() : "";
  if (!id) return { status: "unresolved", targetId: id, reason: "missing_target_id" };
  if (targetKind && !["menu_item", "addon"].includes(targetKind)) {
    return { status: "unresolved", targetId: id, reason: "unsupported_target_kind" };
  }
  const menu = menuItems.filter((row) => row.id === id);
  const extra = addons.filter((row) => row.id === id);
  const candidates = [
    ...menu.map((row) => ({ kind: "menu_item", row })),
    ...extra.map((row) => ({ kind: "addon", row })),
  ].filter((candidate) => !targetKind || candidate.kind === targetKind);
  if (!candidates.length) return { status: "unresolved", targetId: id, reason: "target_not_found" };
  if (candidates.length !== 1) return { status: "ambiguous_target", targetId: id };
  return {
    status: candidates[0].kind === "addon" ? "resolved_addon" : "resolved_menu_item",
    targetId: id,
    targetKind: candidates[0].kind,
    target: candidates[0].row,
  };
}
