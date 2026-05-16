import { supabase } from "../../lib/supabase";
import { getBusinessDayKey } from "./businessDay";

const DEFAULT_BRANCH =
  process.env.REACT_APP_NAC_BRANCH_ID || "khobar";

export async function fetchReviewIntelligence(branchId = DEFAULT_BRANCH, hours = 24) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_review_intelligence", {
    p_branch: branchId,
    p_hours: hours,
  });
  if (error) throw error;
  return data;
}

export async function fetchUnifiedSummary(branchId = DEFAULT_BRANCH, businessDayKey) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_unified_business_day_summary", {
    p_branch: branchId,
    p_business_day_key: businessDayKey || getBusinessDayKey(),
  });
  if (error) throw error;
  return data;
}

export async function fetchBranchComparison(hours = 24) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_branch_comparison", {
    p_hours: hours,
  });
  if (error) throw error;
  return data || [];
}

export async function generateDailySnapshot(branchId = DEFAULT_BRANCH, businessDayKey) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("generate_daily_branch_snapshot", {
    p_branch: branchId,
    p_business_day_key: businessDayKey || getBusinessDayKey(),
  });
  if (error) throw error;
  return data;
}

export async function fetchReviewPortalStaff(branchId = DEFAULT_BRANCH) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("review_portal_staff")
    .select("*")
    .eq("branch_id", branchId.toLowerCase())
    .eq("active", true)
    .order("employee_name");
  if (error) throw error;
  return data || [];
}
