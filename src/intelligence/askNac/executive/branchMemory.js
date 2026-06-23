/**
 * Branch memory retrieval for Ask NAC executive intelligence.
 */

const MEMORY_SELECT = "id, branch_id, category, fact, priority";

/**
 * Fetch active branch operational memory, ordered by priority.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ branch?: string|null, categories?: string[] }} params
 */
export async function fetchBranchMemory(supabase, { branch, categories } = {}) {
  if (!branch) return { branch: null, memories: [], sources: [] };

  let query = supabase
    .from("ask_nac_branch_memory")
    .select(MEMORY_SELECT)
    .eq("branch_id", branch)
    .eq("active", true)
    .order("priority", { ascending: true });

  if (Array.isArray(categories) && categories.length) {
    query = query.in("category", categories);
  }

  const { data, error } = await query;
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

/**
 * Format branch memory lines for answer inclusion.
 */
export function formatBranchMemoryLines(memories = [], { max = 5 } = {}) {
  return memories.slice(0, max).map((m) => `[${m.category}] ${m.fact}`);
}
