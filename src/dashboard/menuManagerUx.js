/** Menu Manager UX helpers — local-only preferences and friendly UI copy. */

import { MENU_PUBLISH_STAGES } from "../lib/menuApi";

export const ONBOARDING_STORAGE_KEY = "nac_menu_manager_onboarding_dismissed_v1";

export const MENU_TOOLTIPS = {
  addItem:
    "Add an existing dish to this section or create a brand-new menu item.",
  addExistingItem:
    "Add a dish that already exists somewhere else in the menu without creating a duplicate.",
  createNewItem:
    "Create a completely new dish that does not already exist.",
  highlightGuest:
    "Feature this item in the Recommended section at the top of the guest menu.",
  soldOut:
    "Guests can see this dish but cannot order it until you mark it available again.",
  visibility:
    "Control whether guests can see this dish on the menu.",
  publish:
    "Update the live guest menu when the status bar shows unpublished changes.",
};

const PUBLISHING_STAGES = new Set([
  MENU_PUBLISH_STAGES.SAVING,
  MENU_PUBLISH_STAGES.DATABASE_UPDATED,
  MENU_PUBLISH_STAGES.VALIDATING,
  MENU_PUBLISH_STAGES.PUBLISHING,
  MENU_PUBLISH_STAGES.REGENERATED,
  MENU_PUBLISH_STAGES.CACHE_UPDATED,
  MENU_PUBLISH_STAGES.VERIFYING,
]);

export function isOnboardingDismissed() {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistOnboardingDismissed(dontShowAgain) {
  if (!dontShowAgain) return;
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

export function resolvePublishBarState({
  publishStage,
  publishStatus,
  retryPublish,
  publishInFlight,
}) {
  if (publishStage === MENU_PUBLISH_STAGES.FAILED || retryPublish) {
    return "failed";
  }
  if (publishInFlight || (publishStage && PUBLISHING_STAGES.has(publishStage))) {
    return "publishing";
  }
  if (publishStatus?.sync_status === "needs_publish") {
    return "waiting";
  }
  return "live";
}

export function friendlyPublishErrorMessage(rawError) {
  const raw = rawError?.message || String(rawError || "");
  if (!raw) {
    return "We couldn't update the guest menu. Please try again.";
  }
  if (/duplicate key|menu_publications_branch_id_version_key|unique constraint/i.test(raw)) {
    return "We couldn't update the guest menu. Please try again.";
  }
  if (/access denied|permission/i.test(raw)) {
    return "You don't have permission to publish this menu.";
  }
  if (/verification|guest menu/i.test(raw)) {
    return "We couldn't verify the guest menu. Please try again.";
  }
  return "We couldn't update the guest menu. Please try again.";
}

export function formatRelativeTimestamp(fromMs, nowMs = Date.now()) {
  const deltaSec = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (deltaSec < 5) return "Updated just now.";
  if (deltaSec < 60) return `Updated ${deltaSec} second${deltaSec === 1 ? "" : "s"} ago.`;
  const mins = Math.round(deltaSec / 60);
  if (mins < 60) return `Updated ${mins} minute${mins === 1 ? "" : "s"} ago.`;
  const hours = Math.round(mins / 60);
  return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago.`;
}

export function buildEditorSnapshot({
  editingItem,
  itemAllergenIds,
  itemAddOnIds,
  extraPlacements,
  imageFile,
  removedPlacementIds,
}) {
  return JSON.stringify({
    editingItem,
    itemAllergenIds: [...(itemAllergenIds || [])].sort(),
    itemAddOnIds: [...(itemAddOnIds || [])].sort(),
    extraPlacements,
    hasImageFile: Boolean(imageFile),
    removedPlacementIds: [...(removedPlacementIds || [])].sort(),
  });
}

export function friendlyActionErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  const raw = error?.message || String(error || "");
  if (!raw) return fallback;
  if (/duplicate key|violates|constraint|SQL|relation|pg_/i.test(raw)) {
    return fallback;
  }
  if (/access denied|permission/i.test(raw)) {
    return "You don't have permission to do that.";
  }
  if (/network|fetch|timeout/i.test(raw)) {
    return "Connection issue. Check your internet and try again.";
  }
  return raw.length > 120 ? fallback : raw;
}

export function guestMenuSuccessMessage(summary) {
  return `✓ ${summary}`;
}

export function formatLastPublishedLabel(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function snapshotsEqual(left, right) {
  return left === right;
}
