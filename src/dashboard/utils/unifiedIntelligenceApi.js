import { supabase } from "../../lib/supabase";
import { fetchBranchComparisonSafe } from "../../lib/intelligenceQueryApi";
import { getBusinessDayKey } from "./businessDay";
import {
  resolveRbacQueryBranch,
  canFetchCrossBranchComparison,
  filterRowsByRbacProfile,
} from "../../lib/rbacQueryScope";

const DEFAULT_BRANCH = process.env.REACT_APP_NAC_BRANCH_ID || "khobar";

export async function fetchReviewIntelligence(branchId = DEFAULT_BRANCH, hours = 24, rbacProfile = null) {
  if (!supabase) return null;
  const branch = resolveRbacQueryBranch(rbacProfile, branchId) || DEFAULT_BRANCH;
  const { data, error } = await supabase.rpc("get_review_intelligence", {
    p_branch: branch,
    p_hours: hours,
  });
  if (error) throw error;
  return data;
}

export async function fetchUnifiedSummary(branchId = DEFAULT_BRANCH, businessDayKey, rbacProfile = null) {
  if (!supabase) return null;
  const branch = resolveRbacQueryBranch(rbacProfile, branchId) || DEFAULT_BRANCH;
  const { data, error } = await supabase.rpc("get_unified_business_day_summary", {
    p_branch: branch,
    p_business_day_key: businessDayKey || getBusinessDayKey(),
  });
  if (error) throw error;
  return data;
}

export async function fetchBranchComparison(hours = 24, rbacProfile = null) {
  if (!supabase) return [];
  if (!canFetchCrossBranchComparison(rbacProfile)) {
    return filterRowsByRbacProfile(rbacProfile, []);
  }
  const { data } = await fetchBranchComparisonSafe(supabase, hours);
  return filterRowsByRbacProfile(rbacProfile, data || []);
}

export async function generateDailySnapshot(branchId = DEFAULT_BRANCH, businessDayKey, rbacProfile = null) {
  if (!supabase) return null;
  const branch = resolveRbacQueryBranch(rbacProfile, branchId) || DEFAULT_BRANCH;
  const { data, error } = await supabase.rpc("generate_daily_branch_snapshot", {
    p_branch: branch,
    p_business_day_key: businessDayKey || getBusinessDayKey(),
  });
  if (error) throw error;
  return data;
}

export async function fetchReviewPortalStaff(branchId = DEFAULT_BRANCH, rbacProfile = null) {
  if (!supabase) return [];
  const branch = resolveRbacQueryBranch(rbacProfile, branchId) || DEFAULT_BRANCH;
  const { data, error } = await supabase
    .from("review_portal_staff")
    .select("*")
    .eq("branch_id", branch.toLowerCase())
    .eq("active", true)
    .order("employee_name");
  if (error) throw error;
  return filterRowsByRbacProfile(rbacProfile, data || []);
}
