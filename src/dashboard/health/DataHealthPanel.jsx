import React, { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { exportViewPerfJson, recentViewPerf } from "../../lib/viewPerf";
import { scanIntegrityBundle } from "./dataIntegrityScan";
import { RECIPE_GAP_CLASS } from "./recipeMappingClassification";

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
    supabase.from("menu_items").select("id,name_en,name_ar,active").limit(800),
    supabase.from("inventory_recipes").select("id,name,normalized_name,menu_item_id,active").limit(800),
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
          {integrity.recipeMapping ? (
            <div data-testid="settings-recipe-mapping">
              <p className="nac-settings-muted">
                Kitchen recipe gaps: {integrity.recipeMapping.originalKitchenNoRecipe}
                {" · "}Exact {integrity.recipeMapping.counts[RECIPE_GAP_CLASS.EXACT_MAPPING_MISSING] || 0}
                {" · "}Likely {integrity.recipeMapping.counts[RECIPE_GAP_CLASS.HIGH_CONFIDENCE_NORMALIZED] || 0}
                {" · "}Ambiguous {integrity.recipeMapping.counts[RECIPE_GAP_CLASS.AMBIGUOUS] || 0}
                {" · "}Legacy {integrity.recipeMapping.counts[RECIPE_GAP_CLASS.LEGACY_ONLY] || 0}
                {" · "}True missing {integrity.recipeMapping.counts[RECIPE_GAP_CLASS.TRUE_MISSING] || 0}
                {" · "}Not recipe-required {integrity.recipeMapping.counts[RECIPE_GAP_CLASS.FALSE_POSITIVE] || 0}
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
                <option value={RECIPE_GAP_CLASS.TRUE_MISSING}>No recipe found</option>
                <option value={RECIPE_GAP_CLASS.FALSE_POSITIVE}>Not recipe-required</option>
              </select>
              <dl className="nac-settings-dl">
                {(integrity.recipeMapping.rows || [])
                  .filter((row) => mappingFilter === "all" || row.class === mappingFilter)
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
