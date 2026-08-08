/** Platform helpers for Menu Manager interaction shortcuts. */

export function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
}

export function isModKey(event) {
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

export function isEditableTarget(target) {
  if (!target || typeof target !== "object") return false;
  const el = target;
  const tag = String(el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest?.("input, textarea, select, [contenteditable='true']"));
}
