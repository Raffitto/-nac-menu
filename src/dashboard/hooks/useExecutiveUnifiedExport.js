import { useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import {
  getBatchForExportPeriod,
  getBatchSalesItems,
  IMPORT_TYPE,
} from "../../lib/foodicsApi";
import { buildExecutiveUnifiedExportPackage } from "../engines/executiveUnifiedExportEngine";
import { exportExecutiveUnifiedPdf } from "../engines/executiveUnifiedPdfExport";
import { exportExecutiveUnifiedXLSX } from "../engines/exportEngine";
import { buildFocusItemCatalog } from "../utils/focusItemCatalog";
import {
  mergeUpsellFocusItems,
  enrichCatalogWithGroups,
} from "../engines/executiveExport/upsellGroups";
import { resolveExportRange } from "../utils/exportRangeState";

const REVIEW_EVENT_SELECT =
  "event_type,employee_name,employee_role,branch_id,source_url,created_at,review_session_id,session_id";

async function loadReviewEvents(exportRange) {
  if (!supabase || !exportRange) return [];
  let query = supabase
    .from("review_events")
    .select(REVIEW_EVENT_SELECT)
    .gte("created_at", exportRange.sinceIso)
    .lte("created_at", exportRange.untilIso);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export function useExecutiveUnifiedExport({ dashboardRange = "7d" } = {}) {
  const [busy, setBusy] = useState(false);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const loadUpsellCatalog = useCallback(async (branchId) => {
    if (!isSupabaseConfigured()) return [];
    setCatalogLoading(true);
    try {
      const [productBatch, waiterBatch] = await Promise.all([
        getBatchForExportPeriod(IMPORT_TYPE.PRODUCT_SALES, branchId),
        getBatchForExportPeriod(IMPORT_TYPE.WAITER_PRODUCT_SALES, branchId),
      ]);
      const [productItems, waiterItems] = await Promise.all([
        productBatch?.id ? getBatchSalesItems(productBatch.id) : Promise.resolve([]),
        waiterBatch?.id ? getBatchSalesItems(waiterBatch.id) : Promise.resolve([]),
      ]);
      const catalog = enrichCatalogWithGroups(buildFocusItemCatalog(productItems, waiterItems));
      setCatalogItems(catalog);
      return catalog;
    } catch {
      setCatalogItems([]);
      return [];
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const buildPackage = useCallback(
    async ({ exportRange, branchId, upsellFocusItems = [], upsellGroupIds = [] }) => {
      const range =
        exportRange ||
        resolveExportRange({ preset: "7d", dashboardRange });

      const mergedFocus = mergeUpsellFocusItems({
        manualItems: upsellFocusItems,
        groupIds: upsellGroupIds,
        catalogItems: catalogItems.length ? catalogItems : await loadUpsellCatalog(branchId),
      });
      const [productBatch, waiterBatch, reviewEvents] = await Promise.all([
        getBatchForExportPeriod(
          IMPORT_TYPE.PRODUCT_SALES,
          branchId,
          range.startDate,
          range.endDate,
        ),
        getBatchForExportPeriod(
          IMPORT_TYPE.WAITER_PRODUCT_SALES,
          branchId,
          range.startDate,
          range.endDate,
        ),
        loadReviewEvents(range),
      ]);

      const [productItems, waiterItems] = await Promise.all([
        productBatch?.id ? getBatchSalesItems(productBatch.id) : Promise.resolve([]),
        waiterBatch?.id ? getBatchSalesItems(waiterBatch.id) : Promise.resolve([]),
      ]);

      return buildExecutiveUnifiedExportPackage({
        exportRange: range,
        branchId,
        productItems,
        waiterItems,
        reviewEvents,
        upsellFocusItems: mergedFocus,
        upsellGroupIds,
        productBatch,
        waiterBatch,
      });
    },
    [dashboardRange, catalogItems, loadUpsellCatalog],
  );

  const generatePdf = useCallback(
    async (opts) => {
      if (!isSupabaseConfigured()) {
        window.alert("Supabase is not configured.");
        return;
      }
      setBusy(true);
      try {
        const pkg = await buildPackage(opts);
        exportExecutiveUnifiedPdf(pkg);
      } catch (e) {
        window.alert(e?.message || "Executive export failed.");
      } finally {
        setBusy(false);
      }
    },
    [buildPackage],
  );

  const generateXlsx = useCallback(
    async (opts) => {
      if (!isSupabaseConfigured()) {
        window.alert("Supabase is not configured.");
        return;
      }
      setBusy(true);
      try {
        const pkg = await buildPackage(opts);
        exportExecutiveUnifiedXLSX(pkg);
      } catch (e) {
        window.alert(e?.message || "Executive export failed.");
      } finally {
        setBusy(false);
      }
    },
    [buildPackage],
  );

  return {
    busy,
    catalogItems,
    catalogLoading,
    loadUpsellCatalog,
    generatePdf,
    generateXlsx,
  };
}
