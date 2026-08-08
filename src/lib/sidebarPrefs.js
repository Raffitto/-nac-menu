/** Personal sidebar collapse preferences (manager UX only — not business data). */

export const SIDEBAR_KEYS = {
  global: "nac.os.ui.sidebar.global.v1",
  menu: "nac.os.ui.sidebar.menu.v1",
};

export const SIDEBAR_EVENTS = {
  globalToggle: "nac:sidebar:global:toggle",
  menuToggle: "nac:sidebar:menu:toggle",
  changed: "nac:sidebar:changed",
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function defaultCollapsedForViewport() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(max-width: 1100px)").matches;
}

export function readSidebarCollapsed(key, fallback = false) {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1" || raw === "true";
  } catch (_) {
    return fallback;
  }
}

export function writeSidebarCollapsed(key, collapsed) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, collapsed ? "1" : "0");
  } catch (_) {
    /* ignore quota / private mode */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_EVENTS.changed, {
        detail: { key, collapsed: Boolean(collapsed) },
      }),
    );
  }
}

export function toggleSidebarCollapsed(key, fallback = false) {
  const next = !readSidebarCollapsed(key, fallback);
  writeSidebarCollapsed(key, next);
  return next;
}

export function emitSidebarToggle(which) {
  if (typeof window === "undefined") return;
  const type =
    which === "menu" ? SIDEBAR_EVENTS.menuToggle : SIDEBAR_EVENTS.globalToggle;
  window.dispatchEvent(new CustomEvent(type));
}

/** Notify layout consumers (e.g. dnd-kit) after width changes settle. */
export function notifyLayoutResize() {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
  });
}
