import { supabase } from "./supabase";
import { applyBranchScopeToSupabaseQuery, filterRowsByRbacProfile } from "./rbacQueryScope";
import { buildConversionRows, getConversionOpportunities } from "../dashboard/utils/foodicsConversion";
import { normalizeTopItems } from "../dashboard/utils/topItemsNormalize";
import { hasVisibilityTracking } from "../dashboard/utils/intelligenceSanity";
import { normalizeFoodicsName } from "../dashboard/utils/foodicsNameNormalize";
import { IMPORT_TYPE } from "../dashboard/config/foodicsImportTypes";

export { IMPORT_TYPE };

export const BATCH_COVERAGE_COLUMNS = "id,branch_id,period_start,period_end,import_type,uploaded_at";

export function coveringBatchIds(batches = [], from, to) {
  return (batches || [])
    .filter((b) => b?.id && b.period_start && b.period_end && b.period_start <= to && b.period_end >= from)
    .map((b) => b.id);
}

export async function getImportBatchItemCounts(batchIds = []) {
  const unique = [...new Set((batchIds || []).filter(Boolean))];
  if (!unique.length) return {};
  const pairs = await Promise.allSettled(
    unique.map(async (id) => {
      const { count, error } = await supabase
        .from("foodics_sales_items")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", id);
      return [id, error ? 0 : Number(count) || 0];
    }),
  );
  return Object.fromEntries(
    pairs.map((result, i) => (
      result.status === "fulfilled" ? result.value : [unique[i], 0]
    )),
  );
}

export function withUsableRowCounts(batches = [], counts = {}) {
  return (batches || []).map((batch) => ({
    ...batch,
    usable_row_count: Number(counts[batch.id] ?? batch.usable_row_count ?? 0),
  }));
}

export async function getImportBatches(limit = 20, importType = null, rbacProfile = null, {
  columns = "*",
  periodFrom = null,
  periodTo = null,
  branchId = null,
} = {}) {
  let query = supabase.from("foodics_import_batches").select(columns);
  if (importType === IMPORT_TYPE.PRODUCT_SALES) {
    query = query.or("import_type.eq.product_sales,import_type.is.null");
  } else if (importType) {
    query = query.eq("import_type", importType);
  }
  if (periodFrom && periodTo) {
    query = query.lte("period_start", periodTo).gte("period_end", periodFrom);
  }
  if (branchId) query = query.eq("branch_id", String(branchId).toLowerCase());
  else query = applyBranchScopeToSupabaseQuery(query, rbacProfile);
  const { data, error } = await query.order("uploaded_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return filterRowsByRbacProfile(rbacProfile, data || []);
}

export async function getBatchSalesItems(batchId) {
  const { data, error } = await supabase
    .from("foodics_sales_items")
    .select("*")
    .eq("batch_id", batchId)
    .order("quantity_sold", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Latest batch — defaults to waiter sales (canonical sales truth). */
export async function getLatestBatch(importType = IMPORT_TYPE.WAITER_PRODUCT_SALES, branchId = null, rbacProfile = null) {
  return getLatestBatchByType(importType, branchId, rbacProfile);
}

export async function getLatestBatchByType(importType = IMPORT_TYPE.WAITER_PRODUCT_SALES, branchId = null, rbacProfile = null) {
  let query = supabase.from("foodics_import_batches").select("*");
  if (importType === IMPORT_TYPE.PRODUCT_SALES) {
    query = query.or("import_type.eq.product_sales,import_type.is.null");
  } else {
    query = query.eq("import_type", importType);
  }
  const scopedBranch = rbacProfile?.authenticated && !rbacProfile.allBranches
    ? rbacProfile.branchScope
    : branchId;
  if (scopedBranch) query = query.eq("branch_id", scopedBranch.toLowerCase());
  else query = applyBranchScopeToSupabaseQuery(query, rbacProfile);
  const { data, error } = await query.order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (data && rbacProfile && !rbacProfile.allBranches) {
    const allowed = filterRowsByRbacProfile(rbacProfile, [data]);
    return allowed[0] || null;
  }
  return data;
}

/** Best overlapping import batch for an export date range. */
export async function getBatchForExportPeriod(
  importType = IMPORT_TYPE.WAITER_PRODUCT_SALES,
  branchId = null,
  startDate = null,
  endDate = null,
  rbacProfile = null,
) {
  const scopedBranch = rbacProfile?.authenticated && !rbacProfile.allBranches
    ? rbacProfile.branchScope
    : branchId;

  if (!startDate || !endDate) {
    return getLatestBatchByType(importType, scopedBranch, rbacProfile);
  }

  let query = supabase.from("foodics_import_batches").select("*");
  if (importType === IMPORT_TYPE.PRODUCT_SALES) {
    query = query.or("import_type.eq.product_sales,import_type.is.null");
  } else {
    query = query.eq("import_type", importType);
  }
  if (scopedBranch) query = query.eq("branch_id", scopedBranch.toLowerCase());
  else query = applyBranchScopeToSupabaseQuery(query, rbacProfile);
  query = query.lte("period_start", endDate).gte("period_end", startDate);

  const { data, error } = await query.order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (data) {
    if (rbacProfile && !rbacProfile.allBranches) {
      const allowed = filterRowsByRbacProfile(rbacProfile, [data]);
      return allowed[0] || null;
    }
    return data;
  }
  return getLatestBatchByType(importType, scopedBranch, rbacProfile);
}

export async function getPreviousBatch(beforeDate) {
  if (!beforeDate) return null;
  const { data, error } = await supabase
    .from("foodics_import_batches")
    .select("*")
    .lt("uploaded_at", beforeDate)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function mapLegacyMapping(row) {
  return {
    ...row,
    foodics_name: row.foodics_name || row.raw_name,
    normalized_key: row.normalized_key || row.normalized_name,
    normalized_name: row.normalized_name || row.normalized_key,
    raw_name: row.raw_name || row.foodics_name,
    confidence: row.match_confidence ?? row.confidence ?? 1,
  };
}

export async function getNameMappings() {
  const { data: primary, error: primaryErr } = await supabase
    .from("foodics_name_mapping")
    .select("*")
    .order("updated_at", { ascending: false });

  if (!primaryErr && primary?.length) {
    return primary.map(mapLegacyMapping);
  }

  const { data: legacy, error: legacyErr } = await supabase.from("menu_item_name_map").select("*");
  if (legacyErr) throw legacyErr;
  return (legacy || []).map(mapLegacyMapping);
}

export async function saveNameMapping({
  raw_name,
  menu_item_name_en,
  menu_item_id,
  confidence = 1,
  match_source = "manual",
}) {
  const normalized_key = normalizeFoodicsName(raw_name);
  const payload = {
    foodics_name: raw_name,
    normalized_key,
    menu_item_name_en,
    menu_item_id: menu_item_id ? String(menu_item_id) : null,
    match_confidence: confidence,
    match_source,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("foodics_name_mapping")
    .upsert(payload, { onConflict: "normalized_key" })
    .select()
    .single();

  if (!error && data) {
    await supabase.from("menu_item_name_map").upsert(
      {
        raw_name,
        normalized_name: normalized_key,
        menu_item_name_en,
        menu_item_id: menu_item_id || null,
        confidence,
      },
      { onConflict: "raw_name" },
    );
    return mapLegacyMapping(data);
  }

  const { data: legacyData, error: legacyErr } = await supabase
    .from("menu_item_name_map")
    .upsert(
      {
        raw_name,
        normalized_name: normalized_key,
        menu_item_name_en,
        menu_item_id: menu_item_id || null,
        confidence,
      },
      { onConflict: "raw_name" },
    )
    .select()
    .single();
  if (legacyErr) throw legacyErr;
  return mapLegacyMapping(legacyData);
}

function toSalesItemPayload(row, batch, meta) {
  const matchedName = (row.matched_menu_item_name || row.raw_item_name || "").trim() || null;
  const rawId = row.matched_menu_item_id;
  const matchedId = rawId != null && String(rawId).trim() !== "" ? String(rawId).trim() : null;

  return {
    batch_id: batch.id,
    branch_id: meta.branch_id || "khobar",
    period_start: meta.period_start,
    period_end: meta.period_end,
    raw_item_name: row.raw_item_name,
    normalized_item_name: row.normalized_item_name,
    matched_menu_item_name: matchedName,
    matched_menu_item_id: matchedId,
    category: row.inherited_category || row.analytics_category || row.category || null,
    semantic_class: row.semantic_class || row.foodics_class || null,
    analytics_category: row.analytics_category || row.inherited_category || null,
    is_modifier: Boolean(row.track_as_modifier),
    waiter_name: row.waiter_name || null,
    product_sku: row.product_sku || null,
    sold_at: row.sold_at ? new Date(row.sold_at).toISOString() : null,
    quantity_sold: row.quantity_sold || 0,
    net_sales: row.net_sales,
    gross_sales: row.gross_sales,
    discount: row.discount,
  };
}

function isUsablePersistedSalesRow(row, importType) {
  if (importType === IMPORT_TYPE.SALES_BY_CREATOR) {
    const name = String(row.waiter_name || "").trim();
    const net = Number(row.net_sales);
    const orders = Number(row.quantity_sold) || 0;
    return Boolean(name) && ((Number.isFinite(net) && net !== 0) || orders > 0);
  }
  if (importType === IMPORT_TYPE.WAITER_PRODUCT_SALES) {
    const name = String(row.raw_item_name || row.matched_menu_item_name || "").trim();
    const waiter = String(row.waiter_name || "").trim();
    const qty = Number(row.quantity_sold) || 0;
    const sales = Number(row.gross_sales) || Number(row.net_sales) || 0;
    return Boolean(name && name !== "__creator__" && waiter) && (qty > 0 || sales > 0);
  }
  return Boolean(row.matched_menu_item_name || row.raw_item_name);
}

export async function createImportBatch(meta, salesRows) {
  const importType = meta.import_type || IMPORT_TYPE.WAITER_PRODUCT_SALES;
  const preview = (salesRows || []).filter((row) => isUsablePersistedSalesRow({
    ...row,
    raw_item_name: row.raw_item_name,
    matched_menu_item_name: row.matched_menu_item_name,
    waiter_name: row.waiter_name,
    quantity_sold: row.quantity_sold,
    net_sales: row.net_sales,
    gross_sales: row.gross_sales,
  }, importType));
  if (!preview.length) {
    throw new Error(
      importType === IMPORT_TYPE.SALES_BY_CREATOR
        ? "The file was received but no usable creator rows were stored. Please upload the file again."
        : "The file was received but no usable product rows were stored. Please upload the file again.",
    );
  }

  const { data: batch, error: batchErr } = await supabase
    .from("foodics_import_batches")
    .insert({
      branch_id: meta.branch_id || "khobar",
      import_type: importType,
      period_type: meta.period_type,
      period_start: meta.period_start,
      period_end: meta.period_end,
      source_file_name: meta.source_file_name,
      uploaded_by: meta.uploaded_by || null,
      notes: meta.notes || null,
    })
    .select()
    .single();
  if (batchErr) throw batchErr;

  const payload = preview.map((row) => toSalesItemPayload(row, batch, meta));

  const { error: itemsErr } = await supabase.from("foodics_sales_items").insert(payload);
  if (itemsErr) {
    await supabase.from("foodics_import_batches").delete().eq("id", batch.id);
    throw itemsErr;
  }

  await persistImportMappings(salesRows);

  return { ...batch, usable_row_count: payload.length };
}

/** Remember matches for future imports — converges toward automatic resolution */
export async function persistImportMappings(rows, minConfidence = 0.72) {
  const seen = new Set();
  const tasks = [];

  for (const row of rows || []) {
    const menuName = row.matched_menu_item_name;
    const conf = Number(row.match_confidence) || 0;
    if (!menuName || conf < minConfidence) continue;
    if (row.import_status === "paid_modifier") continue;

    const variants = row.raw_variants?.length ? row.raw_variants : [row.raw_item_name];
    for (const rawName of variants) {
      const key = normalizeFoodicsName(rawName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tasks.push(
        saveNameMapping({
          raw_name: rawName,
          menu_item_name_en: menuName,
          menu_item_id: row.matched_menu_item_id,
          confidence: Math.max(conf, 0.9),
          match_source: row.match_type || "import",
        }),
      );
    }
  }

  if (tasks.length) await Promise.all(tasks);
}

/** Persist every manual / confirmed mapping immediately (all variants) */
export async function persistMappingForRow(row, menuItemName, menuItemId, source = "manual") {
  const variants = row.raw_variants?.length ? row.raw_variants : [row.raw_item_name];
  const conf = source === "suggestion" ? row.suggested_confidence || 0.88 : 1;
  await Promise.all(
    variants.map((rawName) =>
      saveNameMapping({
        raw_name: rawName,
        menu_item_name_en: menuItemName,
        menu_item_id: menuItemId,
        confidence: Math.max(conf, 0.92),
        match_source: source,
      }),
    ),
  );
}

export async function getMenuItemsForMatching() {
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, name_en, slug, active")
    .eq("active", true)
    .order("name_en");
  if (error) throw error;
  return data || [];
}

export async function getAddOnsForMatching() {
  const { data, error } = await supabase
    .from("add_ons")
    .select("id, name_en, slug, active")
    .eq("active", true)
    .order("name_en");
  if (error) throw error;
  return data || [];
}

/** Load latest Foodics sales + conversion context for AI Insights (waiter import = sales truth). */
export async function getFoodicsIntelligenceContext(analyticsData) {
  try {
    const latest = await getLatestBatchByType(IMPORT_TYPE.WAITER_PRODUCT_SALES);
    if (!latest) {
      return { hasImports: false, batches: [], conversionRows: [], opportunities: null };
    }

    const [salesItems, previousBatch] = await Promise.all([
      getBatchSalesItems(latest.id),
      getPreviousBatch(latest.uploaded_at),
    ]);

    let previousSales = [];
    if (previousBatch?.id) {
      previousSales = await getBatchSalesItems(previousBatch.id);
    }

    const topItems = normalizeTopItems(analyticsData?.top_items || []);
    const conversionRows = buildConversionRows(salesItems, topItems, previousSales);
    const opportunities = getConversionOpportunities(conversionRows);
    const visibilityReady = hasVisibilityTracking(topItems, analyticsData?.by_event_type);

    return {
      hasImports: true,
      latestBatch: latest,
      previousBatch,
      salesItems,
      conversionRows,
      opportunities,
      visibilityReady,
      topItems,
    };
  } catch {
    return { hasImports: false, batches: [], conversionRows: [], opportunities: null };
  }
}
