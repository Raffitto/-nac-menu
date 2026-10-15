/**
 * Branch memory retrieval for Ask NAC executive intelligence (Edge).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { salesQueryDenied } from "./salesBranchAuthorization.ts";

const MEMORY_SELECT = "id, branch_id, category, fact, priority";

export async function fetchBranchMemory(
  supabase: SupabaseClient,
  { branch, profile }: { branch?: string | null; profile?: { authenticated?: boolean | null; allBranches?: boolean | null; branchScope?: string | null; allowedBranchIds?: Array<string | null> | null } | null } = {},
) {
  const denial = salesQueryDenied(profile, { mentionedBranch: branch, filterBranch: branch });
  if (denial) return { branch: branch || null, memories: [], sources: [], authorizationDenied: true };
  if (!branch) return { branch: null, memories: [], sources: [] };

  const { data, error } = await supabase
    .from("ask_nac_branch_memory")
    .select(MEMORY_SELECT)
    .eq("branch_id", branch)
    .eq("active", true)
    .order("priority", { ascending: true });

  if (error) {
    return {
      branch,
      memories: [],
      sources: [],
      warning: `Branch memory could not be loaded: ${error.message}`,
    };
  }

  const memories = (data || []).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    category: row.category,
    fact: row.fact,
    priority: row.priority,
  }));

  return {
    branch,
    memories,
    sources: [{ name: "ask_nac_branch_memory", detail: `${memories.length} operational fact(s)` }],
  };
}

export function formatBranchMemoryLines(
  memories: { fact: string; category?: string }[] = [],
  { max = 5 }: { max?: number } = {},
) {
  return memories.slice(0, max).map((m) => `[${m.category}] ${m.fact}`);
}
