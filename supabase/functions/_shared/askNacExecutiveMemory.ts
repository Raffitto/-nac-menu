/**
 * Unified executive memory — branch + operator with source attribution (Edge).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchBranchMemory } from "./askNacBranchMemory.ts";

const OPERATOR_SELECT = "id, branch_id, category, fact, taught_by, created_at";

export async function fetchOperatorMemory(
  supabase: SupabaseClient,
  { branch }: { branch?: string | null } = {},
) {
  let query = supabase
    .from("ask_nac_operator_memory")
    .select(OPERATOR_SELECT)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (branch) {
    query = query.or(`branch_id.eq.${branch},branch_id.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    return { branch, memories: [], sources: [], warning: error.message };
  }

  const memories = (data || []).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    category: row.category,
    fact: row.fact,
    taughtBy: row.taught_by,
    source: "operator_memory" as const,
  }));

  return {
    branch,
    memories,
    sources: [{ name: "ask_nac_operator_memory", detail: `${memories.length} taught fact(s)` }],
  };
}

export async function fetchExecutiveMemory(
  supabase: SupabaseClient,
  { branch }: { branch?: string | null } = {},
) {
  const [branchResult, operatorResult] = await Promise.all([
    fetchBranchMemory(supabase, { branch }),
    fetchOperatorMemory(supabase, { branch }),
  ]);

  const branchMemories = (branchResult.memories || []).map((m) => ({
    ...m,
    memoryType: "branch_memory" as const,
    source: "branch_memory" as const,
    attribution: "branch operational knowledge",
  }));

  const operatorMemories = (operatorResult.memories || []).map((m) => ({
    ...m,
    memoryType: "operator_memory" as const,
    source: "operator_memory" as const,
    attribution: "previously taught operator knowledge",
  }));

  return {
    branch,
    branchMemories,
    operatorMemories,
    memories: [...branchMemories, ...operatorMemories],
    sources: [...(branchResult.sources || []), ...(operatorResult.sources || [])],
  };
}

export function matchMemoryToGuestQuestion(question = "", memories: { fact?: string; source?: string }[] = []) {
  const q = String(question).toLowerCase();
  if (!/\b(guest|traffic|walk-in|covers|why|down|drop)\b/.test(q)) return [];

  return memories.filter((m) => {
    const fact = String(m.fact || "").toLowerCase();
    if (/\b(humidity|weather|rain|heat)\b/.test(fact) && /\b(guest|traffic|walk-in|down|drop|weather)\b/.test(q)) {
      return true;
    }
    if (/\b(event|ithra|aramco|football|patio)\b/.test(fact) && /\b(guest|traffic|down|drop)\b/.test(q)) {
      return true;
    }
    return false;
  });
}

export function buildMemoryHypotheses(matchedMemories: { fact?: string; source?: string; attribution?: string }[] = []) {
  return matchedMemories.map((m) => ({
    hypothesis: `One possible explanation involves: ${m.fact}`,
    evidence: [m.fact],
    confidence: m.source === "operator_memory" ? "medium" : "low",
    source: m.source,
    attribution: m.source === "operator_memory"
      ? "This conclusion is supported by previously taught operator knowledge."
      : "This conclusion is supported by branch operational knowledge.",
  }));
}
