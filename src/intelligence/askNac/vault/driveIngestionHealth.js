/**
 * Drive ingestion health. A configured cron job is not a healthy pipeline.
 * Four signals stay separate: scheduler, Drive connection, source freshness,
 * and canonical Cash Up publication.
 */

const RIYADH = "Asia/Riyadh";
const SCHEDULER_STALE_MS = 26 * 60 * 60 * 1000;
const SOURCE_STALE_MS = 36 * 60 * 60 * 1000;
const PRIORITY_REPORTS = new Set(["cash_up", "daily_logbook"]);

export function riyadhDateISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDays(isoDate, days) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function latestTimestamp(values) {
  return values.reduce((latest, value) => {
    if (!value) return latest;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return latest;
    if (!latest || time > new Date(latest).getTime()) return value;
    return latest;
  }, null);
}

export function assessDriveIngestionHealth({
  now = new Date(),
  connection = null,
  folders = [],
  latestRun = null,
  publication = null,
  cronJobConfigured = false,
} = {}) {
  const clock = now instanceof Date ? now : new Date(now);
  const riyadhToday = riyadhDateISO(clock);
  const expectedPublicationDate = addCalendarDays(riyadhToday, -1);
  const priority = (folders || []).filter((folder) =>
    PRIORITY_REPORTS.has(String(folder?.report_type || "")),
  );
  const lastAttemptAt = latestTimestamp([
    latestRun?.created_at,
    latestRun?.started_at,
    ...priority.map((folder) => folder.last_sync_at),
  ]);
  const attemptAge = lastAttemptAt ? clock.getTime() - new Date(lastAttemptAt).getTime() : null;
  const schedulerExecuted = attemptAge != null && attemptAge <= SCHEDULER_STALE_MS;

  const scheduler = schedulerExecuted
    ? {
        state: "EXECUTED",
        label: "Executed",
        detail: "A Drive ingest attempt was recorded in the last day. Execution is not publication.",
      }
    : {
        state: "MISSED",
        label: "Missed",
        detail: lastAttemptAt
          ? "No Drive ingest attempt was recorded in the last day."
          : "No Drive ingest attempt is recorded.",
      };

  const status = String(connection?.status || "");
  const lastError = String(connection?.last_error || "");
  const authorizationExpired = Boolean(
    connection
    && (
      connection.reconnect_required
      || status === "reconnect_required"
      || /reconnect|invalid_grant|token_refresh|revoked/i.test(lastError)
      || latestRun?.runtime_stage === "token_refresh_failed"
    ),
  );

  let driveConnection;
  if (!connection) {
    driveConnection = {
      state: "MISSING",
      label: "Not connected",
      detail: "Google Drive is not connected.",
    };
  } else if (authorizationExpired) {
    driveConnection = {
      state: "AUTHORIZATION_EXPIRED",
      label: "Authorization expired",
      detail: "Google rejected the refresh token. Reconnect is required. Ingestion cannot list or download workbooks until then.",
    };
  } else if (status === "active") {
    driveConnection = {
      state: "CONNECTED",
      label: "Connected",
      detail: "Google Drive refresh token is accepted.",
    };
  } else {
    driveConnection = {
      state: "DEGRADED",
      label: "Degraded",
      detail: lastError || "Drive connection is not active.",
    };
  }

  const cashUpFolder = priority.find((folder) => folder.report_type === "cash_up") || null;
  const lastIngestAt = latestTimestamp([
    cashUpFolder?.last_ingest_at,
    ...priority.map((folder) => folder.last_ingest_at),
  ]);
  const ingestAge = lastIngestAt ? clock.getTime() - new Date(lastIngestAt).getTime() : null;
  const sourceFreshness = ingestAge != null && ingestAge <= SOURCE_STALE_MS
    ? {
        state: "CURRENT",
        label: "Current",
        detail: "A priority workbook was ingested within the last day and a half.",
      }
    : {
        state: "STALE",
        label: "Stale",
        detail: lastIngestAt
          ? "The last successful workbook ingest is older than the daily schedule."
          : "No successful workbook ingest is recorded.",
      };

  const publishedThrough = publication?.cashUpPeriodEnd || null;
  let publicationFreshness;
  if (!publication || publishedThrough == null) {
    publicationFreshness = {
      state: "UNKNOWN",
      label: "Unknown",
      detail: "Canonical Cash Up publication date was not loaded. It is not marked current.",
    };
  } else if (publishedThrough >= expectedPublicationDate) {
    publicationFreshness = {
      state: "CURRENT",
      label: "Current",
      detail: `Canonical Cash Up is published through ${publishedThrough}.`,
    };
  } else {
    publicationFreshness = {
      state: "STALLED",
      label: "Stalled",
      detail: `Canonical Cash Up is published through ${publishedThrough}. The completed business date ${expectedPublicationDate} is not published.`,
    };
  }

  const pipelineHealthy = scheduler.state === "EXECUTED"
    && driveConnection.state === "CONNECTED"
    && sourceFreshness.state === "CURRENT"
    && publicationFreshness.state === "CURRENT";

  let primaryIssue = "HEALTHY";
  if (driveConnection.state === "AUTHORIZATION_EXPIRED" || driveConnection.state === "MISSING") {
    primaryIssue = "CONNECTION_REQUIRED";
  } else if (scheduler.state === "MISSED") {
    primaryIssue = "SCHEDULER_MISSED";
  } else if (publicationFreshness.state === "STALLED" || publicationFreshness.state === "UNKNOWN") {
    primaryIssue = "PUBLICATION_STALLED";
  } else if (sourceFreshness.state !== "CURRENT" || driveConnection.state !== "CONNECTED") {
    primaryIssue = "DEGRADED";
  }

  return {
    riyadhToday,
    expectedPublicationDate,
    lastAttemptAt,
    cronJobConfigured: Boolean(cronJobConfigured),
    scheduler,
    driveConnection,
    sourceFreshness,
    publicationFreshness,
    pipelineHealthy,
    primaryIssue,
    summary: pipelineHealthy
      ? "Scheduler, Drive connection, source, and Cash Up publication are current."
      : [
          scheduler.detail,
          driveConnection.detail,
          sourceFreshness.detail,
          publicationFreshness.detail,
        ].join(" "),
  };
}

function eachDate(start, end) {
  const dates = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

/**
 * Classify one business date. workbookDates null means Drive was not listed.
 * This never invents sales figures.
 */
export function classifyCatchUpDate({
  date,
  publishedDates = [],
  canonicalDates = [],
  parsedDates = [],
  downloadedDates = [],
  workbookDates = null,
} = {}) {
  if ((publishedDates || []).includes(date)) return "PUBLISHED";
  if ((canonicalDates || []).includes(date)) return "CANONICALIZED";
  if ((parsedDates || []).includes(date)) return "PARSED";
  if ((downloadedDates || []).includes(date)) return "DOWNLOADED";
  if (workbookDates == null) return "SOURCE_NOT_CHECKED";
  if (!(workbookDates || []).includes(date)) return "MISSING_SOURCE";
  return "AVAILABLE_IN_DRIVE";
}

export function buildCatchUpPlan({
  start,
  end,
  publishedDates = [],
  canonicalDates = [],
  parsedDates = [],
  downloadedDates = [],
  workbookDates = null,
} = {}) {
  return eachDate(start, end).map((date) => ({
    date,
    status: classifyCatchUpDate({
      date,
      publishedDates,
      canonicalDates,
      parsedDates,
      downloadedDates,
      workbookDates,
    }),
  }));
}

export function folderSyncLabel(folder, formatTimestamp = (value) => value) {
  const failed = String(folder?.last_sync_status || "") === "failed";
  if (failed) {
    const published = folder?.last_ingest_at
      ? formatTimestamp(folder.last_ingest_at)
      : "never";
    return `sync failed · last published ${published}`;
  }
  if (folder?.last_ingest_at) return `last published ${formatTimestamp(folder.last_ingest_at)}`;
  if (folder?.last_sync_at) return `last attempt ${formatTimestamp(folder.last_sync_at)}`;
  return "awaiting first sync";
}
