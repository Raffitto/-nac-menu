/**
 * Company Knowledge registry tiers (CK-1).
 * Searchable tier activates in CK-3 when document chunks exist.
 */

export const VAULT_KNOWLEDGE_TIER = Object.freeze({
  STORED: "stored",
  PARSED: "parsed",
  SEARCHABLE: "searchable",
  ASK_NAC_READY: "ask_nac_ready",
});

export const VAULT_KNOWLEDGE_TIER_LABELS = Object.freeze({
  stored: "Stored",
  parsed: "Parsed",
  searchable: "Searchable",
  ask_nac_ready: "Ask-NAC-ready",
});

export const VAULT_SEARCH_INDEX_COMING_SOON = "Coming soon";

/**
 * @param {{
 *   factsPersisted?: number,
 *   readinessStatus?: string,
 *   coverage?: { fact_count?: number, readiness_status?: string },
 *   chunkCount?: number,
 * }} row
 */
export function computeVaultKnowledgeTier(row) {
  const facts =
    Number(row?.factsPersisted ?? row?.coverage?.fact_count ?? 0) || 0;
  const readiness =
    row?.readinessStatus || row?.coverage?.readiness_status || "registered";
  const chunkCount = Number(row?.chunkCount ?? row?.chunk_count ?? 0) || 0;
  const searchStatus = row?.searchStatus ?? row?.search_status ?? "not_searchable";
  const searchable = searchStatus === "searchable" || chunkCount > 0;

  let tier = VAULT_KNOWLEDGE_TIER.STORED;
  if (facts > 0 && (readiness === "ready" || readiness === "partial")) {
    tier = VAULT_KNOWLEDGE_TIER.ASK_NAC_READY;
  } else if (facts > 0 || readiness === "ready" || readiness === "partial") {
    tier = VAULT_KNOWLEDGE_TIER.PARSED;
  }

  if (searchable && tier !== VAULT_KNOWLEDGE_TIER.ASK_NAC_READY) {
    tier = VAULT_KNOWLEDGE_TIER.SEARCHABLE;
  }

  return {
    tier,
    label: VAULT_KNOWLEDGE_TIER_LABELS[tier],
    searchable,
    searchableLabel: searchable
      ? VAULT_KNOWLEDGE_TIER_LABELS.searchable
      : VAULT_SEARCH_INDEX_COMING_SOON,
    isAskNacReady: tier === VAULT_KNOWLEDGE_TIER.ASK_NAC_READY,
    factsPersisted: facts,
  };
}
