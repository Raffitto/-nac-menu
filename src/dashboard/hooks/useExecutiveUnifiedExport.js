import { useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import {
  getBatchForExportPeriod,
  getBatchSalesItems,
  IMPORT_TYPE,
} from "../../lib/foodicsApi";
import { filterRowsByRbacProfile, resolveRbacQueryBranch } from "../../lib/rbacQueryScope";
import { useRbacOptional } from "../context/RbacContext";
import { buildExecutiveUnifiedExportPackage } from "../engines/executiveUnifiedExportEngine";
import { buildFocusItemCatalog } from "../utils/focusItemCatalog";
import { resolveExportRange } from "../utils/exportRangeState";
import {
  mergeUpsellFocusItems,
  enrichCatalogWithGroups,
} from "../engines/executiveExport/upsellGroups";

const REVIEW_EVENT_SELECT =
  "event_type,employee_name,employee_role,branch_id,source_url,created_at,review_session_id,session_id";

async function loadReviewEvents(exportRange, branchId, rbacProfile) {
  if (!supabase || !exportRange) return [];
  const branch = resolveRbacQueryBranch(rbacProfile, branchId);
  let query = supabase
    .from("review_events")
    .select(REVIEW_EVENT_SELECT)
    .gte("created_at", exportRange.sinceIso)
    .lte("created_at", exportRange.untilIso);
  if (branch) query = query.eq("branch_id", branch);
  const { data, error } = await query;
  if (error) throw error;
  return filterRowsByRbacProfile(rbacProfile, data || []);
}

export function useExecutiveUnifiedExport({ dashboardRange = "7d", menuSessions = 0 } = {}) {
  const rbac = useRbacOptional();
  const rbacProfile = rbac?.profile || null;
  const [busy, setBusy] = useState(false);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const loadUpsellCatalog = useCallback(async (branchId) => {
    if (!isSupabaseConfigured()) return [];
    setCatalogLoading(true);
    try {
      const scopedBranch = resolveRbacQueryBranch(rbacProfile, branchId);
      const salesBatch = await getBatchForExportPeriod(
        IMPORT_TYPE.WAITER_PRODUCT_SALES,
        scopedBranch,
        null,
        null,
        rbacProfile,
      );
      const salesItems = salesBatch?.id ? await getBatchSalesItems(salesBatch.id) : [];
      const catalog = enrichCatalogWithGroups(buildFocusItemCatalog(salesItems));
      setCatalogItems(catalog);
      return catalog;
    } catch {
      setCatalogItems([]);
      return [];
    } finally {
      setCatalogLoading(false);
    }
  }, [rbacProfile]);

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

      const scopedBranch = resolveRbacQueryBranch(rbacProfile, branchId);
      const [salesBatch, reviewEvents] = await Promise.all([
        getBatchForExportPeriod(
          IMPORT_TYPE.WAITER_PRODUCT_SALES,
          scopedBranch,
          range.startDate,
          range.endDate,
          rbacProfile,
        ),
        loadReviewEvents(range, scopedBranch, rbacProfile),
      ]);

      const salesItems = salesBatch?.id ? await getBatchSalesItems(salesBatch.id) : [];

      return buildExecutiveUnifiedExportPackage({
        exportRange: range,
        branchId: scopedBranch || branchId,
        salesItems,
        waiterItems: salesItems,
        reviewEvents,
        upsellFocusItems: mergedFocus,
        upsellGroupIds,
        salesBatch,
        menuSessions,
      });
    },
    [dashboardRange, catalogItems, loadUpsellCatalog, menuSessions, rbacProfile],
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
        const { exportExecutiveUnifiedPdf } = await import(
          "../engines/executiveUnifiedPdfExport"
        );
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
        const { exportExecutiveUnifiedXLSX } = await import("../engines/exportEngine");
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
