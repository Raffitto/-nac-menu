/** Menu publish pipeline helpers (idempotency + user-facing errors). */

const DUPLICATE_PUBLISH_PATTERN =
  /duplicate key|menu_publications_branch_id_version_key|unique constraint/i;

export function isPublishDuplicateKeyError(error) {
  const message = error?.message || String(error || "");
  return DUPLICATE_PUBLISH_PATTERN.test(message);
}

export function buildPublishFailureMessage(error) {
  const raw = error?.message || String(error || "Unknown publish error");
  if (isPublishDuplicateKeyError(raw)) {
    return "Publish is already in progress for this branch. Wait a moment, then use Retry publish if the guest menu has not updated.";
  }
  if (/Menu publish conflict/i.test(raw)) {
    return `${raw} Use Retry publish if the guest menu has not updated.`;
  }
  if (raw.startsWith("Database updated.")) return raw;
  return `Database updated. Guest menu not updated. Retry publish. ${raw}`.trim();
}

export function publicationNeedsVerification(publication) {
  if (!publication?.id) return false;
  if (publication.status === "live" && publication.already_live) return false;
  return true;
}
