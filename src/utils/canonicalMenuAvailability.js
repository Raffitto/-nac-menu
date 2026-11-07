// Branch-scoped canonical menu identity and availability helpers.
// This module is intentionally side-effect-free; integrate with menu queries and
// mutations only after validating the current application paths.
export const normalizeMenuName = (name) => String(name ?? '').trim().toLocaleLowerCase('en');

export function canonicalMenuKey(item) {
  if (!item?.branch_id || !item?.name_en) return null;
  const name = normalizeMenuName(item.name_en);
  // Portion-size variants must never collapse into one sellable item.
  const portion = (name === 'kale & cabbage' || name === 'quinoa')
    ? String(item.price ?? '').replace(/[^0-9.]/g, '')
    : '';
  return [item.branch_id, name, portion].join('::');
}

export function isMenuItemVisible(item, now = new Date()) {
  if (!item || item.active === false || item.sold_out === true) return false;
  if (item.hidden_until) {
    const until = new Date(item.hidden_until);
    if (!Number.isNaN(until.getTime()) && now < until) return false;
  }
  return true;
}

export function groupMenuPlacements(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = canonicalMenuKey(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

export function availabilityPatchForBranch(items, branchId, menuName, { unavailable, hiddenUntil = null }) {
  const name = normalizeMenuName(menuName);
  const matches = (items ?? []).filter(item =>
    item.branch_id === branchId && normalizeMenuName(item.name_en) === name
  );
  // Only return a proposed patch. Caller must perform authenticated writes,
  // enforce branch permissions and validate all affected rows transactionally.
  return matches.map(item => ({
    id: item.id,
    branch_id: item.branch_id,
    sold_out: Boolean(unavailable),
    hidden_until: unavailable ? hiddenUntil : null
  }));
}
