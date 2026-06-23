/**
 * Permanent operator-taught knowledge (Teach NAC).
 */

import { inferOperatorMemoryCategory } from "./teachNacParser";

const MEMORY_SELECT = "id, branch_id, category, fact, taught_by, created_at";

export async function storeOperatorMemory(
  supabase,
  { branch, fact, category, taughtBy } = {},
) {
  if (!fact?.trim()) throw new Error("Operator memory fact is required.");
  if (!taughtBy) throw new Error("Authenticated user email required.");

  const row = {
    branch_id: branch || null,
    category: category || inferOperatorMemoryCategory(fact),
    fact: fact.trim(),
    taught_by: taughtBy,
    active: true,
  };

  const { data, error } = await supabase
    .from("ask_nac_operator_memory")
    .insert(row)
    .select(MEMORY_SELECT)
    .single();

  if (error) throw new Error(error.message);

  return {
    memory: {
      id: data.id,
      branchId: data.branch_id,
      category: data.category,
      fact: data.fact,
      taughtBy: data.taught_by,
      source: "operator_memory",
    },
    sources: [{ name: "ask_nac_operator_memory", detail: "operator-taught knowledge saved" }],
  };
}

export async function fetchOperatorMemory(supabase, { branch } = {}) {
  let query = supabase
    .from("ask_nac_operator_memory")
    .select(MEMORY_SELECT)
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
    source: "operator_memory",
  }));

  return {
    branch,
    memories,
    sources: [{ name: "ask_nac_operator_memory", detail: `${memories.length} taught fact(s)` }],
  };
}

export function formatOperatorMemoryLines(memories = [], { max = 5 } = {}) {
  return memories.slice(0, max).map((m) => `[operator · ${m.category}] ${m.fact}`);
}
