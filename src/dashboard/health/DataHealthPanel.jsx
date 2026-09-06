import React, { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { recentViewPerf } from "../../lib/viewPerf";
import { scanMenuIdentityIssues, summarizeIntegrityIssues } from "./dataIntegrityScan";

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

export default function DataHealthPanel() {
  const [rows, setRows] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [perf, setPerf] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupabaseConfigured() || !supabase || typeof supabase.from !== "function") {
        setError("Source unavailable");
        return;
      }
      try {
        const [cash, reviews, foodics, snaps, items] = await Promise.allSettled([
          supabase.from("ask_nac_structured_facts").select("period_end").eq("report_type", "cash_up").order("period_end", { ascending: false }).limit(1),
          supabase.from("google_review_tracking_entries").select("business_date").order("business_date", { ascending: false }).limit(1),
          supabase.from("foodics_import_batches").select("period_end,created_at,import_type").order("created_at", { ascending: false }).limit(3),
          supabase.from("google_review_snapshots").select("snapshot_date,branch_id").order("snapshot_date", { ascending: false }).limit(6),
          supabase.from("menu_items").select("id,sku,name_en").eq("active", true).limit(400),
        ]);

        if (cancelled) return;
        const cashDate = cash.status === "fulfilled" ? cash.value.data?.[0]?.period_end : null;
        const reviewDate = reviews.status === "fulfilled" ? reviews.value.data?.[0]?.business_date : null;
        const foodicsLatest = foodics.status === "fulfilled" ? foodics.value.data?.[0] : null;
        const snapDate = snaps.status === "fulfilled" ? snaps.value.data?.[0]?.snapshot_date : null;
        const menuIssues = items.status === "fulfilled"
          ? summarizeIntegrityIssues(scanMenuIdentityIssues(items.value.data || []))
          : { counts: { ERROR: 0, WARNING: 0, INFO: 0 }, issues: [], total: 0 };

        setRows([
          { label: "Sales / Cash Up current?", value: freshnessLabel(cashDate), status: statusFromDate(cashDate) },
          { label: "Review tracking current?", value: freshnessLabel(reviewDate), status: statusFromDate(reviewDate) },
          { label: "Foodics import current?", value: foodicsLatest ? freshnessLabel(foodicsLatest.period_end || foodicsLatest.created_at) : "Unavailable", status: foodicsLatest ? statusFromDate(foodicsLatest.period_end || foodicsLatest.created_at, 10) : "unavailable" },
          { label: "Google snapshots current?", value: freshnessLabel(snapDate), status: statusFromDate(snapDate) },
        ]);
        setIntegrity(menuIssues);
        setPerf(recentViewPerf());
      } catch (e) {
        if (!cancelled) setError(e?.message || "Health check failed");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="nac-settings-card" data-testid="settings-data-health">
      <h3>
        <Activity size={18} />
        Data health
      </h3>
      <p className="nac-settings-muted">
        Operational freshness and identity diagnostics. Failed sources stay unavailable — they are not shown as zero.
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
        <p className="nac-settings-muted">
          Menu identity: {integrity.counts.ERROR} errors, {integrity.counts.WARNING} warnings, {integrity.counts.INFO} info
          {integrity.issues[0] ? ` — ${integrity.issues[0].message}` : "."}
        </p>
      ) : null}
      {perf?.events?.length ? (
        <p className="nac-settings-muted">
          Recent view timings in developer console: window.__NAC_VIEW_PERF__
          {perf.severe?.length ? ` · ${perf.severe.length} severe (&gt;10s)` : ""}
          {perf.slow?.length ? ` · ${perf.slow.length} slow (&gt;3s)` : ""}
        </p>
      ) : (
        <p className="nac-settings-muted">No view timings captured in this session yet. Inspect window.__NAC_VIEW_PERF__ after navigating.</p>
      )}
    </section>
  );
}
