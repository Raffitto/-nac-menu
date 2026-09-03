import React, { useCallback, useEffect, useMemo, useState } from "react";
import "../styles/platform-os.css";
import { useRbac } from "../context/RbacContext";
import { resolveRbacQueryBranch } from "../../lib/rbacQueryScope";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { createImportBatch, getBatchSalesItems, getImportBatches } from "../../lib/foodicsApi";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { parseFoodicsFile, rowsFromMappedData } from "../utils/foodicsParser";
import { assessExportCoverage, cashUpReady, formatMissingRange, staffPerformanceReady } from "./coverage";
import { validateUploadForNeed } from "./detectFoodicsReport";
import { parseCreatorSummaryFromParsed } from "./parseCreatorSummary";
import { buildCashUpWorkbookBuffer } from "./cashUpWorkbook";
import { buildReviewTrackingWorkbookBuffer } from "./reviewTrackingWorkbook";
import { buildStaffPerformanceReport } from "./staffPerformance";
import { buildStaffPerformancePdfBytes } from "./staffPerformancePdf";
import { downloadBlob, zipStoreFiles } from "./zipStore";
import { aggregateStaffReviewStats } from "../utils/staffReviewStats";

function StatusRow({ item, onUploadNeed }) {
  const missing = formatMissingRange(item.missing);
  return (
    <div className="export-center-status" data-testid={`export-status-${item.id}`}>
      <span>{item.complete ? "✓" : "⚠"} {item.label}{item.complete ? " — Complete" : missing ? ` — Missing ${missing}` : " — Missing selected period"}</span>
      {!item.complete && onUploadNeed && (item.id === IMPORT_TYPE.SALES_BY_CREATOR || item.id === IMPORT_TYPE.WAITER_PRODUCT_SALES) ? (
        <button type="button" className="export-center-upload-btn" onClick={() => onUploadNeed(item.id)}>
          Upload {item.label}
        </button>
      ) : null}
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
  const [needType, setNeedType] = useState(null);
  const [payload, setPayload] = useState({
    cashFacts: [],
    reviewEvents: [],
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
    setBusy(true);
    setError("");
    try {
      const [cashRes, reviewRes, creatorBatches, productBatches] = await Promise.all([
        supabase
          .from("ask_nac_structured_facts")
          .select("metric_key,metric_value,period_end,dimensions,branch_id,report_type")
          .eq("report_type", "cash_up")
          .eq("branch_id", scopedBranch)
          .gte("period_end", from)
          .lte("period_end", to)
          .is("archived_at", null),
        supabase
          .from("review_events")
          .select("employee_name,event_type,created_at,branch_id")
          .eq("branch_id", scopedBranch)
          .gte("created_at", `${from}T00:00:00.000Z`)
          .lte("created_at", `${to}T23:59:59.999Z`),
        getImportBatches(40, IMPORT_TYPE.SALES_BY_CREATOR, rbac.profile),
        getImportBatches(40, IMPORT_TYPE.WAITER_PRODUCT_SALES, rbac.profile),
      ]);

      const cashFacts = (cashRes.data || []).filter((r) => r.branch_id === scopedBranch);
      const cashDates = [...new Set(cashFacts.map((f) => String(f.period_end).slice(0, 10)))];
      const reviewEvents = reviewRes.error ? [] : (reviewRes.data || []);
      const creatorForBranch = (creatorBatches || []).filter((b) => b.branch_id === scopedBranch);
      const productForBranch = (productBatches || []).filter((b) => b.branch_id === scopedBranch);

      const next = assessExportCoverage({
        from,
        to,
        cashUpDates: cashDates,
        reviewAvailable: !reviewRes.error,
        creatorBatches: creatorForBranch,
        productByCreatorBatches: productForBranch,
      });
      setCoverage(next);

      const coveringProduct = productForBranch.filter((b) => b.period_start <= to && b.period_end >= from);
      const coveringCreator = creatorForBranch.filter((b) => b.period_start <= to && b.period_end >= from);
      const productRows = (await Promise.all(coveringProduct.map((b) => getBatchSalesItems(b.id)))).flat();
      const creatorRows = (await Promise.all(coveringCreator.map((b) => getBatchSalesItems(b.id)))).flat();

      setPayload({
        cashFacts,
        reviewEvents,
        creatorRows,
        productRows,
        reviewStats: aggregateStaffReviewStats(reviewEvents),
      });
    } catch (err) {
      setError(err.message || "Could not check report readiness.");
    } finally {
      setBusy(false);
    }
  }, [from, to, scopedBranch, rbac.profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUpload = async (file) => {
    if (!file) return;
    setError("");
    try {
      const parsed = await parseFoodicsFile(file);
      const check = validateUploadForNeed(parsed.headers, needType);
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
      setNeedType(null);
      await refresh();
    } catch (err) {
      setError(err.message || "Upload failed.");
    }
  };

  const downloadAll = async () => {
    setError("");
    if (!coverage) return;
    const folder = `NAC_${scopedBranch}_${from}_to_${to}`;
    const files = [];
    if (cashUpReady(coverage)) {
      files.push({
        name: `${folder}/NAC_${scopedBranch}_Cash_Up_${from}_to_${to}.xlsx`,
        data: new Uint8Array(buildCashUpWorkbookBuffer(payload.cashFacts, { from, to, branch: scopedBranch })),
      });
    }
    if (coverage.reviews.complete) {
      files.push({
        name: `${folder}/NAC_${scopedBranch}_Review_Tracking_${from}_to_${to}.xlsx`,
        data: new Uint8Array(buildReviewTrackingWorkbookBuffer(payload.reviewEvents, { from, to, branch: scopedBranch })),
      });
    }
    if (staffPerformanceReady(coverage)) {
      const report = buildStaffPerformanceReport({
        creatorRows: payload.creatorRows,
        productRows: payload.productRows,
        reviewStats: payload.reviewStats,
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

      <section>
        <h2>Data readiness</h2>
        {busy && !coverage ? <p>Checking sources…</p> : null}
        {coverage ? (
          <>
            <StatusRow item={coverage.cashUp} />
            <StatusRow item={coverage.reviews} />
            <StatusRow item={coverage.salesByCreator} onUploadNeed={setNeedType} />
            <StatusRow item={coverage.salesByProductByCreator} onUploadNeed={setNeedType} />
          </>
        ) : null}
      </section>

      {needType ? (
        <div className="export-center-upload">
          <p>Upload {needType === IMPORT_TYPE.SALES_BY_CREATOR ? "Sales by Creator" : "Sales by Product by Creator"} (CSV / XLS / XLSX)</p>
          <input
            type="file"
            accept=".csv,.xls,.xlsx"
            onChange={(e) => handleUpload(e.target.files?.[0])}
          />
        </div>
      ) : null}

      {error ? <p className="export-center-error" role="alert">{error}</p> : null}

      <div className="export-center-actions">
        <button type="button" className="export-center-primary" onClick={downloadAll} disabled={busy}>
          Download Reports
        </button>
      </div>
    </div>
  );
}
