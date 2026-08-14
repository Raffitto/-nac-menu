/**
 * Drive file identity vs revision — used to decide skip vs reprocess.
 * Keep source identity (Drive file id) separate from revision (checksum/version/mtime).
 */

export type DriveRevisionSignals = {
  md5Checksum?: string;
  version?: string;
  modifiedTime?: string;
};

export type VaultFileRevisionRow = {
  content_hash?: string | null;
  source_external_checksum?: string | null;
  source_external_version?: string | null;
  external_source_modified_at?: string | null;
  searchable?: boolean | null;
  chunk_count?: number | null;
};

export type CoverageFreshnessRow = {
  last_ingested_at?: string | null;
  period_end?: string | null;
  fact_count?: number | null;
} | null;

export function isSearchableIndexed(existing: VaultFileRevisionRow | null | undefined) {
  return Boolean(existing?.searchable) && Number(existing?.chunk_count || 0) > 0;
}

/** True when registry metadata moved forward but canonical facts were not republished. */
export function canonicalFactsBehindSource(
  existing: VaultFileRevisionRow | null | undefined,
  coverage: CoverageFreshnessRow,
  driveFile?: DriveRevisionSignals | null,
) {
  if (!existing) return false;
  if (!coverage) return true;
  const ingested = coverage.last_ingested_at ? Date.parse(String(coverage.last_ingested_at)) : NaN;
  const sourceMod = existing.external_source_modified_at
    ? Date.parse(String(existing.external_source_modified_at))
    : NaN;
  const driveMod = driveFile?.modifiedTime ? Date.parse(driveFile.modifiedTime) : NaN;
  const newestSource = Number.isFinite(driveMod) ? Math.max(sourceMod || 0, driveMod) : sourceMod;
  if (!Number.isFinite(ingested) || ingested <= 0) return true;
  if (!Number.isFinite(newestSource) || newestSource <= 0) return false;
  return ingested + 1000 < newestSource;
}

export function isUnchangedDriveFile(
  existing: VaultFileRevisionRow | null | undefined,
  driveFile: DriveRevisionSignals,
  coverage: CoverageFreshnessRow = null,
) {
  if (!existing) return false;
  // Same Drive ID/name with a newer revision must reprocess even if checksum was already written.
  if (canonicalFactsBehindSource(existing, coverage, driveFile)) return false;
  // Prior extract/index failures leave registry rows that must be retried.
  if (!isSearchableIndexed(existing) && !coverage?.last_ingested_at) return false;
  if (driveFile.md5Checksum && existing.source_external_checksum === driveFile.md5Checksum) return true;
  if (driveFile.version && existing.source_external_version === String(driveFile.version)) return true;
  if (driveFile.modifiedTime && existing.external_source_modified_at) {
    return new Date(driveFile.modifiedTime).getTime() <= new Date(existing.external_source_modified_at).getTime();
  }
  return false;
}
