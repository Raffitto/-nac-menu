/**
 * Shared Sales Intelligence data hook — batches, sales lines, menu behavior slice.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../../lib/supabase";
import { getImportBatches, getBatchSalesItems, getLatestBatchByType } from "../../../lib/foodicsApi";
import { normalizeTopItems } from "../../utils/topItemsNormalize";
import { useMenuBiDashboardContext } from "../../context/MenuBiDashboardContext";
import { usePlatformFiltersOptional } from "../../context/PlatformFiltersContext";
import { useRbacOptional } from "../../context/RbacContext";
import { resolveRbacQueryBranch } from "../../../lib/rbacQueryScope";
import { IMPORT_TYPE } from "../../config/foodicsImportTypes";

export function useSalesIntelligenceData() {
  const filters = usePlatformFiltersOptional();
  const rbac = useRbacOptional();
  const rbacProfile = rbac?.profile || null;
  const { data: biData } = useMenuBiDashboardContext();

  const [salesItems, setSalesItems] = useState([]);
  const [previousSalesItems, setPreviousSalesItems] = useState([]);
  const [salesBatch, setSalesBatch] = useState(null);
  const [previousBatch, setPreviousBatch] = useState(null);
  const [batches, setBatches] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const branch = resolveRbacQueryBranch(rbacProfile, filters?.branch || null);
      const batchList = await getImportBatches(48, IMPORT_TYPE.WAITER_PRODUCT_SALES, rbacProfile);
      setBatches(batchList);

      const scoped = branch
        ? batchList.filter((b) => String(b.branch_id).toLowerCase() === String(branch).toLowerCase())
        : batchList;

      const latest = scoped[0] || (await getLatestBatchByType(IMPORT_TYPE.WAITER_PRODUCT_SALES, branch, rbacProfile));
      const prior = scoped.find((b) => b.id !== latest?.id) || batchList.find((b) => b.id !== latest?.id) || null;

      setSalesBatch(latest || null);
      setPreviousBatch(prior || null);

      const [currentRows, priorRows] = await Promise.all([
        latest?.id ? getBatchSalesItems(latest.id) : Promise.resolve([]),
        prior?.id ? getBatchSalesItems(prior.id) : Promise.resolve([]),
      ]);

      setSalesItems(currentRows);
      setPreviousSalesItems(priorRows);
      setTopItems(normalizeTopItems(biData?.top_items || []));
    } catch {
      setSalesItems([]);
      setPreviousSalesItems([]);
      setBatches([]);
      setSalesBatch(null);
      setPreviousBatch(null);
    } finally {
      setLoading(false);
    }
  }, [filters?.branch, biData?.top_items, rbacProfile]);

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    loading,
    batches,
    salesBatch,
    previousBatch,
    salesItems,
    previousSalesItems,
    topItems,
    totalSessions: biData?.total_sessions || 0,
    reload,
  };
}
