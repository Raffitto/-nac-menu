/**
 * Unified executive memory — branch + operator with source attribution.
 */

import { fetchBranchMemory } from "./branchMemory";
import { fetchOperatorMemory } from "./operatorMemory";

export async function fetchExecutiveMemory(supabase, { branch } = {}) {
  const [branchResult, operatorResult] = await Promise.all([
    fetchBranchMemory(supabase, { branch }),
    fetchOperatorMemory(supabase, { branch }),
  ]);

  const branchMemories = (branchResult.memories || []).map((m) => ({
    ...m,
    memoryType: "branch_memory",
    source: "branch_memory",
    attribution: "branch operational knowledge",
  }));

  const operatorMemories = (operatorResult.memories || []).map((m) => ({
    ...m,
    memoryType: "operator_memory",
    source: "operator_memory",
    attribution: "previously taught operator knowledge",
  }));

  return {
    branch,
    branchMemories,
    operatorMemories,
    memories: [...branchMemories, ...operatorMemories],
    sources: [
      ...(branchResult.sources || []),
      ...(operatorResult.sources || []),
    ],
  };
}

/**
 * Match operator/branch memory to guest/traffic questions for hypothesis hints.
 */
export function matchMemoryToGuestQuestion(question = "", memories = []) {
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

export function buildMemoryHypotheses(matchedMemories = []) {
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
