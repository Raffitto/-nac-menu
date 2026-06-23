/**
 * Audit counts for Executive Reports / Weekly Dashboards Drive ingestion.
 */
export async function fetchWeeklyDashboardIngestionAudit(supabase, { branchId = null } = {}) {
  const folderQuery = supabase
    .from("ask_nac_drive_sync_folders")
    .select("id, folder_name, label, report_type, auto_ingest, branch_id, drive_folder_id, last_ingest_at")
    .or("report_type.eq.weekly_dashboard,folder_name.ilike.%weekly dashboard%,label.ilike.%weekly dashboard%,folder_name.ilike.%executive report%,label.ilike.%executive report%");

  const { data: folders, error: folderError } = await folderQuery;
  if (folderError) throw folderError;

  const scopedFolders = branchId
    ? (folders || []).filter((folder) => folder.branch_id === branchId)
    : folders || [];

  let fileQuery = supabase
    .from("ask_nac_files")
    .select("id, title, report_type, searchable, search_status, primary_branch_id, created_at")
    .eq("report_type", "weekly_dashboard");

  if (branchId) fileQuery = fileQuery.eq("primary_branch_id", branchId);

  const { data: files, error: fileError } = await fileQuery;
  if (fileError) throw fileError;

  const fileIds = (files || []).map((file) => file.id);
  let extractedCount = 0;
  let searchableCount = 0;
  let structuredFactCount = 0;
  let insightSamples = [];

  for (const file of files || []) {
    if (file.searchable || file.search_status === "indexed") searchableCount += 1;
    if (file.search_status === "indexed" || file.search_status === "completed") extractedCount += 1;
  }

  if (fileIds.length) {
    const { data: facts } = await supabase
      .from("ask_nac_vault_structured_facts")
      .select("metric_key, dimensions, metric_value, period_start, period_end, file_id")
      .in("file_id", fileIds)
      .in("metric_key", ["executive_summary_line", "operational_commentary_line", "total_sales", "guest_count"])
      .limit(20);

    structuredFactCount = facts?.length || 0;
    insightSamples = (facts || [])
      .filter((fact) => fact.metric_key?.includes("line") || fact.metric_key === "total_sales")
      .slice(0, 6)
      .map((fact) => ({
        metricKey: fact.metric_key,
        value: fact.metric_value ?? fact.dimensions?.text_value ?? null,
        periodStart: fact.period_start,
        periodEnd: fact.period_end,
      }));
  }

  const latestRunIds = scopedFolders.map((folder) => folder.id);
  let discoveredCount = 0;
  let downloadedCount = 0;

  if (latestRunIds.length) {
    const { data: runs } = await supabase
      .from("ask_nac_drive_sync_runs")
      .select("discovered_count, downloaded_count, extracted_count, indexed_count, folder_id, completed_at")
      .in("folder_id", latestRunIds)
      .order("completed_at", { ascending: false })
      .limit(5);

    discoveredCount = runs?.[0]?.discovered_count || 0;
    downloadedCount = runs?.[0]?.downloaded_count || 0;
    extractedCount = Math.max(extractedCount, runs?.[0]?.extracted_count || 0);
    searchableCount = Math.max(searchableCount, runs?.[0]?.indexed_count || searchableCount);
  }

  return {
    registeredFolders: scopedFolders,
    folderRegistered: scopedFolders.length > 0,
    autoIngestEnabled: scopedFolders.some((folder) => folder.auto_ingest),
    discoveredCount: discoveredCount || files?.length || 0,
    downloadedCount: downloadedCount || files?.length || 0,
    extractedCount,
    searchableCount: searchableCount || (files || []).filter((file) => file.searchable).length,
    fileCount: files?.length || 0,
    reportType: "weekly_dashboard",
    structuredFactCount,
    exampleExecutiveInsights: insightSamples,
  };
}
