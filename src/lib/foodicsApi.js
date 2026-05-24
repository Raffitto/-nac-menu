import { supabase } from "./supabase";
import { buildConversionRows, getConversionOpportunities } from "../dashboard/utils/foodicsConversion";
import { normalizeTopItems } from "../dashboard/utils/topItemsNormalize";
import { hasVisibilityTracking } from "../dashboard/utils/intelligenceSanity";
import { normalizeFoodicsName } from "../dashboard/utils/foodicsNameNormalize";
import { IMPORT_TYPE } from "../dashboard/config/foodicsImportTypes";

export { IMPORT_TYPE };

export async function getImportBatches(limit = 20, importType = null) {
  let query = supabase.from("foodics_import_batches").select("*");
  if (importType === IMPORT_TYPE.PRODUCT_SALES) {
    query = query.or("import_type.eq.product_sales,import_type.is.null");
  } else if (importType) {
    query = query.eq("import_type", importType);
  }
  const { data, error } = await query.order("uploaded_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
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

/** Latest batch — defaults to product_sales lane for backward compatibility */
export async function getLatestBatch(importType = IMPORT_TYPE.PRODUCT_SALES, branchId = null) {
  return getLatestBatchByType(importType, branchId);
}

export async function getLatestBatchByType(importType = IMPORT_TYPE.PRODUCT_SALES, branchId = null) {
  let query = supabase.from("foodics_import_batches").select("*");
  if (importType === IMPORT_TYPE.PRODUCT_SALES) {
    query = query.or("import_type.eq.product_sales,import_type.is.null");
  } else {
    query = query.eq("import_type", importType);
  }
  if (branchId) query = query.eq("branch_id", branchId.toLowerCase());
  const { data, error } = await query.order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

/** Best overlapping import batch for an export date range. */
export async function getBatchForExportPeriod(
  importType = IMPORT_TYPE.PRODUCT_SALES,
  branchId = null,
  startDate = null,
  endDate = null,
) {
  if (!startDate || !endDate) {
    return getLatestBatchByType(importType, branchId);
  }

  let query = supabase.from("foodics_import_batches").select("*");
  if (importType === IMPORT_TYPE.PRODUCT_SALES) {
    query = query.or("import_type.eq.product_sales,import_type.is.null");
  } else {
    query = query.eq("import_type", importType);
  }
  if (branchId) query = query.eq("branch_id", branchId.toLowerCase());
  query = query.lte("period_start", endDate).gte("period_end", startDate);

  const { data, error } = await query.order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (data) return data;
  return getLatestBatchByType(importType, branchId);
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

export async function createImportBatch(meta, salesRows) {
  const { data: batch, error: batchErr } = await supabase
    .from("foodics_import_batches")
    .insert({
      branch_id: meta.branch_id || "khobar",
      import_type: meta.import_type || IMPORT_TYPE.PRODUCT_SALES,
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

  const isWaiterImport = (meta.import_type || IMPORT_TYPE.PRODUCT_SALES) === IMPORT_TYPE.WAITER_PRODUCT_SALES;

  const payload = salesRows
    .map((row) => toSalesItemPayload(row, batch, meta))
    .filter((row) => {
      if (isWaiterImport) {
        const hasSales =
          (Number(row.quantity_sold) || 0) > 0 ||
          (Number(row.gross_sales) || 0) > 0 ||
          (Number(row.net_sales) || 0) > 0;
        return hasSales && (row.waiter_name || row.raw_item_name);
      }
      return Boolean(row.matched_menu_item_name);
    });

  if (payload.length) {
    const { error: itemsErr } = await supabase.from("foodics_sales_items").insert(payload);
    if (itemsErr) throw itemsErr;
  }

  await persistImportMappings(salesRows);

  return batch;
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

/** Load latest Foodics + conversion context for AI Insights */
export async function getFoodicsIntelligenceContext(analyticsData) {
  try {
    const latest = await getLatestBatchByType(IMPORT_TYPE.PRODUCT_SALES);
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
