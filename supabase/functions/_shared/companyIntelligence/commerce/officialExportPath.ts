/**
 * Track B — official Foodics export → async email → ingest.
 * Bounded investigation only. Authenticated list/detail remains production.
 */

export const OFFICIAL_EXPORT_CHAIN_STATUS = "BLOCKED_EXTERNAL_DEPENDENCY" as const;

export type OfficialExportChainStatus = typeof OFFICIAL_EXPORT_CHAIN_STATUS;

export const OFFICIAL_EXPORT_CHAIN = {
  status: OFFICIAL_EXPORT_CHAIN_STATUS,
  productionSource: "authenticated_foodics_list_detail" as const,
  destinationMailbox: "foh.khobar@nacriyadh.com",
  assessedAt: "2026-08-19",
  components: {
    playwrightCdp: {
      adoption: "EVALUATE" as const,
      license: "Apache-2.0",
      feasible: false,
      note:
        "Playwright/CDP can reuse a legitimate Foodics web session to submit an export request, "
        + "but Orders/Order Items are delivered asynchronously by email. Browser automation does not "
        + "retrieve the attachment without mailbox access.",
    },
    microsoftGraph: {
      feasible: false,
      note: "Delegated mailbox access is blocked by Microsoft admin consent.",
    },
    imapMailbox: {
      feasible: false,
      note: "No IMAP/mailbox credentials are present. Do not build a custom mail client.",
    },
    outlookAppleScript: {
      feasible: false,
      note: "Outlook desktop AppleScript is not a viable unattended transport.",
    },
  },
  reason:
    "Official Foodics Orders/Order Items exports are async-email to foh.khobar@nacriyadh.com. "
    + "Unattended matching/download needs mailbox access. Microsoft Graph delegated access is blocked "
    + "by admin consent; IMAP credentials are absent; Outlook AppleScript is not viable. Playwright/CDP "
    + "cannot close the chain without that mailbox. Production source remains authenticated Foodics "
    + "list + per-order detail.",
  nextOperatorAction:
    "If official CSV is required later, grant a least-privilege mailbox read path (IMAP or Graph) "
    + "without Microsoft admin work from autonomous workers. Until then do not spend cycles on export UI.",
};

export function officialExportChainStatus(): OfficialExportChainStatus {
  return OFFICIAL_EXPORT_CHAIN.status;
}

export function officialExportEvidenceFields(): Record<string, null> {
  return {
    exportRequestId: null,
    exportRequestedAt: null,
    matchingEmailId: null,
    matchingEmailAt: null,
    downloadedFilename: null,
    downloadedChecksum: null,
    exportValidationResult: null,
    exportIngestionResult: null,
  };
}
