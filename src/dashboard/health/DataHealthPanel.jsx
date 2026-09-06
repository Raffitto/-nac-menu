import React, { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { exportViewPerfJson, recentViewPerf } from "../../lib/viewPerf";
import { scanIntegrityBundle } from "./dataIntegrityScan";
import { RECIPE_GAP_CLASS } from "./recipeMappingClassification";
import { CLUSTER_KIND } from "./identityClusters";

function freshnessLabel(iso) {
  if (!iso) return "Unknown";
  return String(iso).slice(0, 10);
}

function statusFromDate(iso, staleAfterDays = 2) {
  if (!iso) return "unavailable";
  const day = String(iso).slice(0, 10);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  if (day === today || day === yesterdayRiyadh()) return "current";
  const age = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86400000;
  if (age <= staleAfterDays) return "partial";
  return "stale";
}

function yesterdayRiyadh() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

async function loadIntegrityPayload() {
  const settled = await Promise.allSettled([
    supabase.from("menu_items").select("id,name_en,name_ar,active,price,section_id,branch_id,placement_group_id").limit(2000),
    supabase.from("inventory_recipes").select("id,name,normalized_name,menu_item_id,active").limit(2000),
    supabase.from("inventory_recipe_versions").select("id,recipe_id,version_number,status").limit(1200),
    supabase.from("inventory_recipe_version_lines").select("id,recipe_version_id,ingredient_id,sub_recipe_id,quantity").limit(4000),
    supabase.from("inventory_ingredients").select("id,canonical_name,active,base_inventory_unit").limit(800),
  ]);
  const pick = (i) => (settled[i].status === "fulfilled" ? settled[i].value.data || [] : []);
  return scanIntegrityBundle({
    menuItems: pick(0),
    recipes: pick(1),
    versions: pick(2),
    lines: pick(3),
    ingredients: pick(4),
    inventoryItems: null,
    scannedAt: new Date().toISOString(),
  });
}

export default function DataHealthPanel() {
  const [rows, setRows] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [perf, setPerf] = useState(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [mappingFilter, setMappingFilter] = useState("all");
  const [clusterFilter, setClusterFilter] = useState("all");

  const runScan = useCallback(async () => {
    if (!isSupabaseConfigured() || !supabase || typeof supabase.from !== "function") {
      setError("Source unavailable");
      return;
    }
    setScanning(true);
    setError("");
    try {
      const [cash, reviews, foodics, snaps] = await Promise.allSettled([
        supabase.from("ask_nac_structured_facts").select("period_end").eq("report_type", "cash_up").order("period_end", { ascending: false }).limit(1),
        supabase.from("google_review_tracking_entries").select("business_date").order("business_date", { ascending: false }).limit(1),
        supabase.from("foodics_import_batches").select("period_end,created_at,import_type").order("created_at", { ascending: false }).limit(3),
        supabase.from("google_review_snapshots").select("snapshot_date,branch_id").order("snapshot_date", { ascending: false }).limit(6),
      ]);
      const cashDate = cash.status === "fulfilled" ? cash.value.data?.[0]?.period_end : null;
      const reviewDate = reviews.status === "fulfilled" ? reviews.value.data?.[0]?.business_date : null;
      const foodicsLatest = foodics.status === "fulfilled" ? foodics.value.data?.[0] : null;
      const snapDate = snaps.status === "fulfilled" ? snaps.value.data?.[0]?.snapshot_date : null;
      setRows([
        { label: "Sales / Cash Up current?", value: freshnessLabel(cashDate), status: statusFromDate(cashDate) },
        { label: "Review tracking current?", value: freshnessLabel(reviewDate), status: statusFromDate(reviewDate) },
        { label: "Foodics import current?", value: foodicsLatest ? freshnessLabel(foodicsLatest.period_end || foodicsLatest.created_at) : "Unavailable", status: foodicsLatest ? statusFromDate(foodicsLatest.period_end || foodicsLatest.created_at, 10) : "unavailable" },
        { label: "Google snapshots current?", value: freshnessLabel(snapDate), status: statusFromDate(snapDate) },
      ]);
      setIntegrity(await loadIntegrityPayload());
      setPerf(recentViewPerf());
    } catch (e) {
      setError(e?.message || "Health check failed");
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    runScan();
  }, [runScan]);

  const downloadManifest = () => {
    if (!integrity) return;
    const payload = {
      scannedAt: integrity.scannedAt,
      identity: integrity.identityClusters,
      recipeMapping: {
        counts: integrity.recipeMapping?.counts,
        clusterCounts: integrity.recipeMapping?.clusterCounts,
        repairPlan: integrity.recipeMapping?.repairPlan || [],
        repaired: integrity.recipeMapping?.repaired || 0,
      },
      costClasses: integrity.costClasses,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nac-identity-repair-manifest.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsv = () => {
    if (!integrity) return;
    const clusters = integrity.identityClusters?.duplicateClusters || [];
    const header = [
      "normalized_identity",
      "kind",
      "duplicate_count",
      "branch_ids",
      "menu_item_ids",
      "prices",
    ];
    const lines = [header.join(",")];
    for (const row of clusters) {
      const cells = [
        row.normalizedName,
        row.kind,
        row.activeCount,
        (row.branchIds || []).join("|"),
        (row.activeItemIds || []).join("|"),
        (row.prices || []).join("|"),
      ].map((cell) => `"${String(cell ?? "").replace(/"/g, "\"\"")}"`);
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nac-identity-repair-manifest.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPerf = () => {
    const blob = new Blob([exportViewPerfJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nac-view-perf.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="nac-settings-card" data-testid="settings-data-health">
      <h3>
        <Activity size={18} />
        Data health
      </h3>
      <p className="nac-settings-muted">
        Operational freshness and identity diagnostics. Failed sources stay unavailable — they are not shown as zero. Super Admin only.
      </p>
      {error ? <p className="nac-settings-warn">{error}</p> : null}
      {!rows ? <p className="nac-settings-muted">Checking sources…</p> : (
        <dl className="nac-settings-dl">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value} · {row.status}</dd>
            </div>
          ))}
        </dl>
      )}
      {integrity ? (
        <div data-testid="settings-integrity-scan">
          <p className="nac-settings-muted">
            Critical {integrity.actionCounts?.CRITICAL ?? integrity.counts.ERROR}
            {" · "}Needs review {integrity.actionCounts?.NEEDS_REVIEW ?? integrity.counts.WARNING}
            {" · "}Informational {integrity.actionCounts?.INFORMATIONAL ?? integrity.counts.INFO}
            · last scan {String(integrity.scannedAt || "").slice(11, 19) || "—"}
          </p>
          <dl className="nac-settings-dl">
            {(integrity.groups || []).slice(0, 12).map((group) => (
              <div key={`${group.category}-${group.code}`}>
                <dt>{group.severity} · {group.category} · {group.code} ({group.count})</dt>
                <dd>{group.examples[0]}{group.source ? ` · ${group.source}` : ""}</dd>
              </div>
            ))}
          </dl>
          {(integrity.capabilityGaps || []).map((gap) => (
            <p key={gap.code} className="nac-settings-muted">{gap.message}</p>
          ))}
          {integrity.identityClusters ? (
            <div data-testid="settings-identity-clusters">
              <p className="nac-settings-muted">
                Repeated identities: {integrity.identityClusters.duplicateClusterCount}
                {" · "}rows {integrity.identityClusters.rowsInsideDuplicateClusters}
                {" · "}cross-branch copies {integrity.identityClusters.branchCopyCount}
                {" · "}same live item {integrity.identityClusters.sameLiveItemCount}
                {" · "}same-branch placements {integrity.identityClusters.sameBranchPlacementCount || 0}
                {" · "}confirmed defects {integrity.identityClusters.exactDefectCount}
              </p>
              <p className="nac-settings-muted">
                Row level: active kitchen menu rows without a direct recipe FK.
                Identity level: Food Bible unique live kitchen identities after placement/name dedupe.
                Do not treat row-level gaps as recipes to create. Management view is unique live kitchen
                identities (last measured 53 kitchen / 43 mapped / 10 missing), not the unlinked-row count.
              </p>
              <label className="nac-settings-muted" htmlFor="identity-cluster-filter">Identity filter</label>
              <select
                id="identity-cluster-filter"
                value={clusterFilter}
                onChange={(event) => setClusterFilter(event.target.value)}
              >
                <option value="all">All repeated identities</option>
                <option value={CLUSTER_KIND.BRANCH_COPY}>Cross-branch copies</option>
                <option value={CLUSTER_KIND.SAME_LIVE_ITEM}>Same live item</option>
                <option value="SAME_BRANCH">Same-branch placements</option>
                <option value={CLUSTER_KIND.AMBIGUOUS}>Potential identity conflict</option>
                <option value={CLUSTER_KIND.EXACT_DUPLICATE_DEFECT}>Confirmed defect</option>
                <option value={CLUSTER_KIND.VARIANT}>Variants</option>
                <option value={CLUSTER_KIND.LEGACY_CONTAMINATION}>Legacy + active</option>
              </select>
              <dl className="nac-settings-dl">
                {(integrity.identityClusters.duplicateClusters || [])
                  .filter((row) => {
                    if (clusterFilter === "all") return true;
                    if (clusterFilter === "SAME_BRANCH") return row.hasSameBranchPlacements;
                    return row.kind === clusterFilter;
                  })
                  .slice(0, 40)
                  .map((row) => (
                    <div key={row.normalizedName}>
                      <dt>{row.kind} · {row.displayName} ({row.activeCount})</dt>
                      <dd>
                        {(row.branchIds || []).join(", ") || "no branch"}
                        {" · "}{row.activeItemIds.slice(0, 4).join(", ")}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          ) : null}
          {integrity.costClasses ? (
            <p className="nac-settings-muted" data-testid="settings-cost-classes">
              Missing costs: operational {integrity.costClasses.ACTIVE_OPERATIONAL}
              {" · "}legacy {integrity.costClasses.LEGACY_INACTIVE}
              {" · "}OCR {integrity.costClasses.OCR_PLACEHOLDER}
              {" · "}derived {integrity.costClasses.DERIVED_SUB_RECIPE}
              {" · "}unknown {integrity.costClasses.UNKNOWN}
            </p>
          ) : null}
          {integrity.recipeMapping ? (
            <div data-testid="settings-recipe-mapping">
              <p className="nac-settings-muted">
                Kitchen recipe gap rows: {integrity.recipeMapping.originalKitchenNoRecipe}
                {" · "}clusters exact {integrity.recipeMapping.clusterCounts?.[RECIPE_GAP_CLASS.EXACT_MAPPING_MISSING] || 0}
                {" · "}clusters ambiguous {integrity.recipeMapping.clusterCounts?.[RECIPE_GAP_CLASS.AMBIGUOUS] || 0}
                {" · "}clusters true missing {integrity.recipeMapping.clusterCounts?.[RECIPE_GAP_CLASS.TRUE_MISSING] || 0}
                {" · "}safe repair plans {integrity.recipeMapping.deterministicRepairable || 0}
                {" · "}written {integrity.recipeMapping.repaired || 0}
              </p>
              <label className="nac-settings-muted" htmlFor="recipe-mapping-filter">Mapping filter</label>
              <select
                id="recipe-mapping-filter"
                value={mappingFilter}
                onChange={(event) => setMappingFilter(event.target.value)}
              >
                <option value="all">All gaps</option>
                <option value={RECIPE_GAP_CLASS.EXACT_MAPPING_MISSING}>Exact mapping available</option>
                <option value={RECIPE_GAP_CLASS.HIGH_CONFIDENCE_NORMALIZED}>Likely mapping</option>
                <option value={RECIPE_GAP_CLASS.AMBIGUOUS}>Ambiguous</option>
                <option value={RECIPE_GAP_CLASS.LEGACY_ONLY}>Legacy only</option>
                <option value={RECIPE_GAP_CLASS.SOURCE_CARD_UNLINKED}>Source card only</option>
                <option value={RECIPE_GAP_CLASS.TRUE_MISSING}>No recipe found</option>
                <option value={RECIPE_GAP_CLASS.FALSE_POSITIVE}>Not recipe-required</option>
                <option value="SAFE_UNIQUE">Safe unique recipe</option>
                <option value="DUPLICATE_IDENTITY">Duplicate identity</option>
              </select>
              <dl className="nac-settings-dl">
                {(integrity.recipeMapping.rows || [])
                  .filter((row) => {
                    if (mappingFilter === "all") return true;
                    if (mappingFilter === "SAFE_UNIQUE") {
                      return row.class === RECIPE_GAP_CLASS.EXACT_MAPPING_MISSING
                        || row.class === RECIPE_GAP_CLASS.HIGH_CONFIDENCE_NORMALIZED;
                    }
                    if (mappingFilter === "DUPLICATE_IDENTITY") return (row.clusterActiveCount || 1) > 1;
                    return row.class === mappingFilter;
                  })
                  .slice(0, 40)
                  .map((row) => (
                    <div key={row.itemId}>
                      <dt>{row.class} · {row.itemName}</dt>
                      <dd>
                        {row.candidates[0]?.name || "no candidate"}
                        {" · "}{Math.round((row.confidence || 0) * 100)}%
                        {" · "}{row.reason}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="nac-settings-actions">
        <button type="button" className="nac-filter-action" onClick={runScan} disabled={scanning}>
          {scanning ? "Scanning…" : "Rescan"}
        </button>
        <button type="button" className="nac-filter-action" onClick={downloadManifest}>
          Export identity manifest
        </button>
        <button type="button" className="nac-filter-action" onClick={downloadCsv}>
          Export identity CSV
        </button>
        <button type="button" className="nac-filter-action" onClick={downloadPerf}>
          Export view timings
        </button>
      </div>
      {perf?.events?.length ? (
        <p className="nac-settings-muted">
          {perf.events.length} recent view events · {perf.severe?.length || 0} severe · {perf.slow?.length || 0} slow
        </p>
      ) : (
        <p className="nac-settings-muted">No view timings captured in this session yet.</p>
      )}
    </section>
  );
}
