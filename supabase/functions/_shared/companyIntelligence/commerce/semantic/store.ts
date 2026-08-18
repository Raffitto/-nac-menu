import type { CommerceStore } from "./execute.ts";
import type { SemanticItem, SemanticOrder, SemanticSession } from "./operators.ts";

type Sb = {
  from: (table: string) => {
    select: (cols: string) => any;
  };
};

async function page<T>(make: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>, max: number): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export function createSupabaseCommerceStore(supabase: Sb): CommerceStore {
  return {
    async fetchOrders({ branchId, startDate, endDate }) {
      return page<SemanticOrder>((from, to) => supabase.from("commerce_orders")
        .select("source_order_id,branch_id,business_date,opened_at,closed_at,order_type,covers,subtotal,tax,net_sales,status,table_id")
        .eq("branch_id", branchId)
        .gte("business_date", startDate)
        .lte("business_date", endDate)
        .range(from, to), 20000);
    },
    async fetchItems({ branchId, startDate, endDate }) {
      return page<SemanticItem>((from, to) => supabase.from("commerce_order_items")
        .select("source_order_id,source_order_item_id,branch_id,business_date,product_id,canonical_menu_item_id,item_name,canonical_category,quantity,net_amount,status")
        .eq("branch_id", branchId)
        .gte("business_date", startDate)
        .lte("business_date", endDate)
        .range(from, to), 80000);
    },
    async fetchSessions({ branchId, startDate, endDate }) {
      return page<SemanticSession>((from, to) => supabase.from("commerce_sessions")
        .select("source_order_id,branch_id,business_date,covers,net_sales,item_count,archetype,flags")
        .eq("branch_id", branchId)
        .gte("business_date", startDate)
        .lte("business_date", endDate)
        .range(from, to), 20000);
    },
    async fetchCoverage(branchId) {
      const iso = (v: unknown) => {
        const s = String(v || "");
        return s.length >= 10 ? s.slice(0, 10) : null;
      };
      let startDate: string | null = null;
      let endDate: string | null = null;
      const snapStart = await supabase.from("commerce_published_snapshots")
        .select("period_start")
        .eq("branch_id", branchId)
        .eq("status", "published")
        .order("period_start", { ascending: true })
        .limit(1);
      const snapEnd = await supabase.from("commerce_published_snapshots")
        .select("period_end")
        .eq("branch_id", branchId)
        .eq("status", "published")
        .order("period_end", { ascending: false })
        .limit(1);
      startDate = iso(snapStart.data?.[0]?.period_start);
      endDate = iso(snapEnd.data?.[0]?.period_end);
      const { data: fresh } = await supabase.from("commerce_dataset_freshness")
        .select("data_through")
        .eq("branch_id", branchId)
        .eq("dataset", "orders")
        .limit(1);
      const through = iso(fresh?.[0]?.data_through);
      if (through && (!endDate || through > endDate)) endDate = through;
      if (!startDate || !endDate) {
        const { data } = await supabase.from("commerce_orders")
          .select("business_date")
          .eq("branch_id", branchId)
          .order("business_date", { ascending: true })
          .limit(1);
        const { data: last } = await supabase.from("commerce_orders")
          .select("business_date")
          .eq("branch_id", branchId)
          .order("business_date", { ascending: false })
          .limit(1);
        startDate = startDate || iso(data?.[0]?.business_date);
        endDate = endDate || iso(last?.[0]?.business_date);
      }
      if (!startDate || !endDate) return null;
      return { branchId, startDate, endDate, ordersStatus: "ready", itemsStatus: "ready" };
    },
  };
}

export function createMemoryCommerceStore(input: {
  orders: SemanticOrder[];
  items: SemanticItem[];
  sessions?: SemanticSession[];
  coverage?: { branchId: string; startDate: string; endDate: string };
}): CommerceStore {
  return {
    async fetchOrders({ branchId, startDate, endDate }) {
      return input.orders.filter((o) => o.branch_id === branchId && o.business_date >= startDate && o.business_date <= endDate);
    },
    async fetchItems({ branchId, startDate, endDate }) {
      return input.items.filter((i) => i.branch_id === branchId && i.business_date >= startDate && i.business_date <= endDate);
    },
    async fetchSessions({ branchId, startDate, endDate }) {
      return (input.sessions || []).filter((s) => s.branch_id === branchId && s.business_date >= startDate && s.business_date <= endDate);
    },
    async fetchCoverage(branchId) {
      return input.coverage?.branchId === branchId ? input.coverage : null;
    },
  };
}
