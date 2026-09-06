import React, { useCallback, useEffect, useMemo, useState } from "react";
import "../styles/platform-os.css";
import { useRbac } from "../context/RbacContext";
import { resolveRbacQueryBranch } from "../../lib/rbacQueryScope";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { BATCH_COVERAGE_COLUMNS, createImportBatch, getBatchSalesItems, getImportBatches } from "../../lib/foodicsApi";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { parseFoodicsFile, rowsFromMappedData } from "../utils/foodicsParser";
import { assessExportCoverage, cashUpDownloadable, formatMissingDatesList, staffPerformanceReady } from "./coverage";
import { validateUploadForNeed } from "./detectFoodicsReport";
import { FOODICS_SOURCE_GUIDE, formatExportDateRange } from "./foodicsSourceGuide";
import { parseCreatorSummaryFromParsed } from "./parseCreatorSummary";
import { fetchCanonicalCashUpForExport, fetchCashUpCoverage } from "./cashUpSource";
import { fetchReviewTrackingCoverage } from "./reviewCoverage";
import { getCachedIntelligence, cacheKey } from "../utils/intelligenceCache";
import { buildCashUpWorkbookBuffer } from "./cashUpWorkbook";
import { aggregateReviewTrackingStats, buildReviewTrackingWorkbookBuffer } from "./reviewTrackingWorkbook";
import { buildStaffPerformanceReport } from "./staffPerformance";
import { buildStaffPerformancePdfBytes } from "./staffPerformancePdf";
import { downloadBlob, zipStoreFiles } from "./zipStore";
function StatusRow({ item, from, to, onUpload }) {
  const guide = FOODICS_SOURCE_GUIDE[item.id];
  const rangeLabel = formatExportDateRange(from, to);
  if (item.id === "cash_up") {
    const missingList = formatMissingDatesList(item.missing);
    return (
      <div className="export-center-status" data-testid={`export-status-${item.id}`}>
        {item.status === "ready" ? (
          <p className="export-center-status-line">✓ Cash Up — Ready</p>
        ) : item.status === "partial" ? (
          <div>
            <p className="export-center-status-line">⚠ Cash Up — Partial</p>
            <p className="export-center-foodics-path">Missing Cash Up: {missingList}</p>
          </div>
        ) : (
          <div className="export-center-missing">
            <p className="export-center-status-line">Missing: Cash Up</p>
            <p className="export-center-foodics-path">
              {missingList ? `Missing Cash Up: ${missingList}` : "Missing selected period"}
            </p>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="export-center-status" data-testid={`export-status-${item.id}`}>
      {item.complete ? (
        <p className="export-center-status-line">✓ {item.label} — Complete</p>
      ) : (
        <div className="export-center-missing">
          <p className="export-center-status-line">Missing: {item.label}</p>
          {guide ? (
            <>
              <p className="export-center-foodics-path">Foodics: {guide.foodicsPath}</p>
              <p className="export-center-use-range">Use: {rangeLabel}</p>
              <label className="export-center-upload-btn">
                Upload file
                <input
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={(e) => onUpload?.(item.id, e.target.files?.[0])}
                />
              </label>
            </>
          ) : (
            <p className="export-center-foodics-path">
              {item.missing?.length ? `Missing ${item.missing[0]}${item.missing.length > 1 ? ` → ${item.missing[item.missing.length - 1]}` : ""}` : "Missing selected period"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ExportCenter() {
  const rbac = useRbac();
  const branchOptions = rbac.exportBranchOptions || [];
  const [branch, setBranch] = useState(branchOptions[0]?.value || "khobar");
  const [from, setFrom] = useState("2026-08-01");
  const [to, setTo] = useState("2026-08-31");
  const [coverage, setCoverage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState({
    cashFacts: [],
    reviewEntries: [],
    creatorRows: [],
    productRows: [],
    reviewStats: [],
  });

  const scopedBranch = useMemo(
    () => resolveRbacQueryBranch(rbac.profile, branch) || "khobar",
    [rbac.profile, branch],
  );

  useEffect(() => {
    setBranch(scopedBranch);
  }, [scopedBranch]);

  const refresh = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setError("NAC data connection is not available.");
      return;
    }
    setError("");
    const persistKey = `nac-reports-coverage:${scopedBranch}:${from}:${to}`;
    const historical = to && to < new Date().toISOString().slice(0, 10);
    const persistTtl = historical ? 10 * 60 * 1000 : 45 * 1000;
    try {
      const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(persistKey) : null;
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored?.coverage && Date.now() - Number(stored.at || 0) < persistTtl) {
          setCoverage(stored.coverage);
        }
      }
    } catch {
      /* ignore stale persist */
    }
    setBusy(true);
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const cacheId = cacheKey(["reports-coverage", scopedBranch, from, to]);
      const packed = await getCachedIntelligence(
        cacheId,
        async () => {
          const [cashUp, reviewCoverage, creatorBatches, productBatches] = await Promise.all([
            fetchCashUpCoverage(supabase, { branch: scopedBranch, from, to }),
            fetchReviewTrackingCoverage(supabase, { branch: scopedBranch, from, to }),
            getImportBatches(40, IMPORT_TYPE.SALES_BY_CREATOR, rbac.profile, { columns: BATCH_COVERAGE_COLUMNS }),
            getImportBatches(40, IMPORT_TYPE.WAITER_PRODUCT_SALES, rbac.profile, { columns: BATCH_COVERAGE_COLUMNS }),
          ]);
          return { cashUp, reviewCoverage, creatorBatches, productBatches };
        },
        persistTtl,
      );

      const { cashUp, reviewCoverage, creatorBatches, productBatches } = packed;
      const cashDates = cashUp.cashUpDates || [];
      if (cashUp.error && !cashDates.length) {
        setError(`Cash Up coverage query failed: ${cashUp.error}`);
      }
      if (reviewCoverage.error && !(reviewCoverage.reviewDates || []).length) {
        setError((prev) => prev || `Review coverage query failed: ${reviewCoverage.error}`);
      }
      const reviewDates = reviewCoverage.reviewDates || [];
      const creatorForBranch = (creatorBatches || []).filter((b) => b.branch_id === scopedBranch);
      const productForBranch = (productBatches || []).filter((b) => b.branch_id === scopedBranch);

      const next = assessExportCoverage({
        from,
        to,
        cashUpDates: cashDates,
        reviewDates,
        creatorBatches: creatorForBranch,
        productByCreatorBatches: productForBranch,
      });
      setCoverage(next);
      try {
        sessionStorage.setItem(persistKey, JSON.stringify({ coverage: next, at: Date.now() }));
      } catch {
        /* ignore quota */
      }
      if (typeof window !== "undefined") {
        window.__NAC_REPORTS_PERF__ = {
          coverageMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started),
          cashDates: cashDates.length,
          reviewDates: reviewDates.length,
        };
      }
    } catch (err) {
      setError(err.message || "Could not check report readiness.");
    } finally {
      setBusy(false);
    }
  }, [from, to, scopedBranch, rbac.profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUpload = async (neededType, file) => {
    if (!file) return;
    setError("");
    try {
      const parsed = await parseFoodicsFile(file);
      const check = validateUploadForNeed(parsed.headers, neededType);
      if (!check.ok) {
        setError(check.error);
        return;
      }
      let rows;
      let importType = check.detected;
      if (importType === IMPORT_TYPE.SALES_BY_CREATOR) {
        const creator = parseCreatorSummaryFromParsed(parsed.headers, parsed.rawRows);
        if (creator.error) {
          setError(creator.error);
          return;
        }
        rows = creator.rows;
      } else {
        const mapped = rowsFromMappedData(parsed.rawRows, parsed.mapping, {
          importType: IMPORT_TYPE.WAITER_PRODUCT_SALES,
        });
        if (mapped.error) {
          setError(mapped.error);
          return;
        }
        rows = mapped.rows;
        importType = IMPORT_TYPE.WAITER_PRODUCT_SALES;
      }
      await createImportBatch(
        {
          branch_id: scopedBranch,
          import_type: importType,
          period_type: "custom",
          period_start: from,
          period_end: to,
          source_file_name: file.name,
          uploaded_by: rbac.profile?.email || "export-center",
          notes: "Export Center upload",
        },
        rows,
      );
      await refresh();
    } catch (err) {
      setError(err.message || "Upload failed.");
    }
  };

  const loadExportPayload = async () => {
    const [cashUp, reviewRes, creatorBatches, productBatches] = await Promise.all([
      fetchCanonicalCashUpForExport(supabase, { branch: scopedBranch, from, to }),
      supabase
        .from("google_review_tracking_entries")
        .select("staff_name,source_staff_name,review_date,review_count,source_file_id,source_sheet,source_drive_file_id,ingested_at,branch_id")
        .eq("branch_id", scopedBranch)
        .gte("review_date", from)
        .lte("review_date", to),
      getImportBatches(40, IMPORT_TYPE.SALES_BY_CREATOR, rbac.profile),
      getImportBatches(40, IMPORT_TYPE.WAITER_PRODUCT_SALES, rbac.profile),
    ]);
    const reviewEntries = reviewRes.error ? [] : (reviewRes.data || []).filter((r) => r.branch_id === scopedBranch);
    const creatorForBranch = (creatorBatches || []).filter((b) => b.branch_id === scopedBranch);
    const productForBranch = (productBatches || []).filter((b) => b.branch_id === scopedBranch);
    const coveringProduct = productForBranch.filter((b) => b.period_start <= to && b.period_end >= from);
    const coveringCreator = creatorForBranch.filter((b) => b.period_start <= to && b.period_end >= from);
    const [productRows, creatorRows] = await Promise.all([
      Promise.all(coveringProduct.map((b) => getBatchSalesItems(b.id))).then((rows) => rows.flat()),
      Promise.all(coveringCreator.map((b) => getBatchSalesItems(b.id))).then((rows) => rows.flat()),
    ]);
    const nextPayload = {
      cashFacts: cashUp.facts || [],
      reviewEntries,
      creatorRows,
      productRows,
      reviewStats: aggregateReviewTrackingStats(reviewEntries, { from, to }),
    };
    setPayload(nextPayload);
    return nextPayload;
  };

  const downloadAll = async () => {
    setError("");
    if (!coverage) return;
    let pack = payload;
    const needsRows =
      (staffPerformanceReady(coverage) && (!pack.creatorRows.length || !pack.productRows.length))
      || (cashUpDownloadable(coverage) && !pack.cashFacts.length)
      || !pack.reviewEntries.length;
    if (needsRows) {
      setBusy(true);
      try {
        pack = await loadExportPayload();
      } catch (err) {
        setError(err.message || "Could not load report files.");
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    const folder = `NAC_${scopedBranch}_${from}_to_${to}`;
    const files = [];
    if (cashUpDownloadable(coverage) && pack.cashFacts.length) {
      files.push({
        name: `${folder}/NAC_${scopedBranch}_Cash_Up_${from}_to_${to}.xlsx`,
        data: new Uint8Array(buildCashUpWorkbookBuffer(pack.cashFacts, { from, to, branch: scopedBranch })),
      });
    }
    if (pack.reviewEntries.length) {
      files.push({
        name: `${folder}/NAC_${scopedBranch}_Review_Tracking_${from}_to_${to}.xlsx`,
        data: new Uint8Array(buildReviewTrackingWorkbookBuffer(pack.reviewEntries, { from, to, branch: scopedBranch })),
      });
    }
    if (staffPerformanceReady(coverage)) {
      const report = buildStaffPerformanceReport({
        creatorRows: pack.creatorRows,
        productRows: pack.productRows,
        reviewStats: pack.reviewStats,
        branch: scopedBranch,
        from,
        to,
      });
      files.push({
        name: `${folder}/NAC_${scopedBranch}_Staff_Performance_${from}_to_${to}.pdf`,
        data: new Uint8Array(buildStaffPerformancePdfBytes(report)),
      });
    }
    if (!files.length) {
      setError("MISSING SOURCE: upload the missing Foodics reports before download.");
      return;
    }
    downloadBlob(zipStoreFiles(files), `${folder}.zip`, "application/zip");
  };

  const blocked = !rbac.hasPermission("export:data") && !rbac.hasPermission("view:reports");

  if (blocked) {
    return <p>Reports are not enabled for this account.</p>;
  }

  return (
    <div className="export-center" data-testid="export-center">
      <header className="nac-platform-header">
        <p className="nac-platform-kicker">NAC Hospitality OS</p>
        <h1>Reports</h1>
        <p className="nac-platform-sub">Download Cash Up, Review Tracking, and Staff Performance for a selected range. Incomplete Foodics files must be uploaded first.</p>
      </header>

      <div className="export-center-form">
        <label>
          Branch
          <select value={scopedBranch} onChange={(e) => setBranch(e.target.value)} disabled={branchOptions.length <= 1}>
            {branchOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <p className="export-center-range-banner" data-testid="export-center-range">
        Export this exact Foodics date range: <strong>{formatExportDateRange(from, to)}</strong>
      </p>

      <section>
        <h2>Data readiness</h2>
        {busy && !coverage ? <p>Checking sources…</p> : null}
        {coverage ? (
          <>
            <StatusRow item={coverage.cashUp} from={from} to={to} />
            <div className="export-center-status" data-testid="export-status-reviews">
              <p className={`export-center-status-line ${coverage.reviews.complete ? "" : "export-center-review-warning"}`}>
                {coverage.reviews.message}
              </p>
            </div>
            <StatusRow item={coverage.salesByCreator} from={from} to={to} onUpload={handleUpload} />
            <StatusRow item={coverage.salesByProductByCreator} from={from} to={to} onUpload={handleUpload} />
          </>
        ) : null}
      </section>

      {error ? <p className="export-center-error" role="alert">{error}</p> : null}

      <div className="export-center-actions">
        <button type="button" className="export-center-primary" onClick={downloadAll} disabled={busy}>
          Download Reports
        </button>
      </div>
    </div>
  );
}
