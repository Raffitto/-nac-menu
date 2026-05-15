import { supabase } from "./supabase";
import { buildConversionRows, getConversionOpportunities } from "../dashboard/utils/foodicsConversion";

export async function getImportBatches(limit = 20) {
  const { data, error } = await supabase
    .from("foodics_import_batches")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(limit);
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

export async function getLatestBatch() {
  const { data, error } = await supabase
    .from("foodics_import_batches")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
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

export async function getNameMappings() {
  const { data, error } = await supabase.from("menu_item_name_map").select("*");
  if (error) throw error;
  return data || [];
}

export async function saveNameMapping({ raw_name, menu_item_name_en, menu_item_id, confidence = 1 }) {
  const normalized_name = raw_name.toLowerCase().trim();
  const { data, error } = await supabase
    .from("menu_item_name_map")
    .upsert(
      {
        raw_name,
        normalized_name,
        menu_item_name_en,
        // menu_item_name_map.menu_item_id FK is menu_items only — add-on mappings use name only
        menu_item_id: menu_item_id || null,
        confidence,
      },
      { onConflict: "raw_name" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
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
    category: row.category || null,
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

  const payload = salesRows
    .map((row) => toSalesItemPayload(row, batch, meta))
    .filter((row) => row.matched_menu_item_name);

  if (payload.length) {
    const { error: itemsErr } = await supabase.from("foodics_sales_items").insert(payload);
    if (itemsErr) throw itemsErr;
  }

  return batch;
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
    const latest = await getLatestBatch();
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

    const topItems = analyticsData?.top_items || [];
    const conversionRows = buildConversionRows(salesItems, topItems, previousSales);
    const opportunities = getConversionOpportunities(conversionRows);

    return {
      hasImports: true,
      latestBatch: latest,
      previousBatch,
      salesItems,
      conversionRows,
      opportunities,
    };
  } catch {
    return { hasImports: false, batches: [], conversionRows: [], opportunities: null };
  }
}
