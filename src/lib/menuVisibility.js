/** Guest-menu visibility — single source of truth with Menu Manager / Supabase. */

export function parseHiddenUntil(item) {
  const raw = item?.hidden_until ?? item?.hiddenUntil;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** True when the item must not appear on the public menu. */
export function isHiddenFromPublicMenu(item, nowMs = Date.now()) {
  if (!item) return true;
  if (item.active === false) return true;
  const until = parseHiddenUntil(item);
  return until != null && until > nowMs;
}

/** True when the item should render on the guest menu (may still be sold out). */
export function isPublicMenuItem(item, nowMs = Date.now()) {
  return !isHiddenFromPublicMenu(item, nowMs);
}

export function formatDurationShort(ms) {
  if (ms <= 0) return "0m";
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatTimeLocal(isoOrMs, locale = undefined) {
  const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  return d.toLocaleString(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Status for Menu Manager badges.
 * @returns {{ key: 'active'|'hidden'|'hidden_until'|'reopens_in', label: string }}
 */
export function getItemVisibilityBadge(item, nowMs = Date.now()) {
  if (!item) return { key: "hidden", label: "Hidden" };
  if (item.active === false) return { key: "hidden", label: "Hidden" };

  const untilMs = parseHiddenUntil(item);
  if (untilMs != null && untilMs > nowMs) {
    const remaining = untilMs - nowMs;
    if (remaining <= 24 * 60 * 60 * 1000) {
      return {
        key: "reopens_in",
        label: `Reopens in ${formatDurationShort(remaining)}`,
      };
    }
    return {
      key: "hidden_until",
      label: `Hidden until ${formatTimeLocal(untilMs)}`,
    };
  }

  return { key: "active", label: "Active" };
}

export function computeHiddenUntilIso({ mode, hours, dateTimeLocal }) {
  const now = Date.now();
  if (mode === "hours") {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return null;
    return new Date(now + h * 60 * 60 * 1000).toISOString();
  }
  if (mode === "datetime" && dateTimeLocal) {
    const d = new Date(dateTimeLocal);
    if (!Number.isFinite(d.getTime()) || d.getTime() <= now) return null;
    return d.toISOString();
  }
  return null;
}

/** Filter menuData tree to guest-visible items only. */
export function filterPublicMenuData(menuData, nowMs = Date.now()) {
  if (!menuData) return menuData;
  const next = {};
  for (const [catId, sections] of Object.entries(menuData)) {
    next[catId] = (sections || [])
      .map((sec) => ({
        ...sec,
        items: (sec.items || []).filter((it) => isPublicMenuItem(it, nowMs)),
      }))
      .filter((sec) => sec.items.length > 0);
  }
  return next;
}

/** Next ms when a scheduled hide expires (for client refresh timers). */
export function nextVisibilityExpiryMs(menuData) {
  const now = Date.now();
  let next = null;
  for (const sections of Object.values(menuData || {})) {
    for (const sec of sections || []) {
      for (const it of sec.items || []) {
        const until = parseHiddenUntil(it);
        if (until != null && until > now) {
          if (next == null || until < next) next = until;
        }
      }
    }
  }
  return next;
}
