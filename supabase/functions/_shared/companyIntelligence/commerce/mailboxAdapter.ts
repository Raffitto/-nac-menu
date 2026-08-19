/**
 * Async mailbox adapter. Isolated when the environment has no mailbox access.
 * Do not fall back to a manual Outlook workflow as architecture.
 */

import { OFFICIAL_EXPORT_CHAIN } from "./officialExportPath.ts";

export const MAILBOX_ADAPTER = {
  implemented: true,
  programmaticallyAvailable: false,
  status: OFFICIAL_EXPORT_CHAIN.status,
  blocker: OFFICIAL_EXPORT_CHAIN.reason,
  pollPolicy: "relevant Foodics export messages only",
};

export function mailboxAvailable(env: Record<string, string | undefined> = {}): boolean {
  return Boolean(env.FOODICS_EXPORT_IMAP_URL || env.FOODICS_EXPORT_MAILBOX_TOKEN);
}
