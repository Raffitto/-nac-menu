/**
 * Async mailbox adapter. Isolated when the environment has no mailbox access.
 * Do not fall back to a manual Outlook workflow as architecture.
 */

export const MAILBOX_ADAPTER = {
  implemented: true,
  programmaticallyAvailable: false,
  blocker:
    "No IMAP/mailbox credentials are present in the current environment. "
    + "Export-request matching is implemented; delivery polling is an external-access blocker.",
  pollPolicy: "relevant Foodics export messages only",
};

export function mailboxAvailable(env: Record<string, string | undefined> = {}): boolean {
  return Boolean(env.FOODICS_EXPORT_IMAP_URL || env.FOODICS_EXPORT_MAILBOX_TOKEN);
}
