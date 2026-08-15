export type CommerceQuality = {
  productUuidMappingPct: number | null;
  itemRowMappingPct: number | null;
  revenueMappingPct: number | null;
  confidentlyClassifiedSessionPct: number | null;
  unclassifiedSessionPct: number | null;
  orderItemJoinPct: number | null;
};

export function emptyQuality(): CommerceQuality {
  return {
    productUuidMappingPct: null,
    itemRowMappingPct: null,
    revenueMappingPct: null,
    confidentlyClassifiedSessionPct: null,
    unclassifiedSessionPct: null,
    orderItemJoinPct: null,
  };
}

export function formatPct(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

export function qualityNarrative(q: CommerceQuality): string {
  return (
    `${formatPct(q.confidentlyClassifiedSessionPct)} of sessions were classifiable. `
    + `Product mappings cover ${formatPct(q.itemRowMappingPct)} of item rows and ${formatPct(q.revenueMappingPct)} of item revenue`
    + (q.productUuidMappingPct != null ? ` (${formatPct(q.productUuidMappingPct)} of unique products)` : "")
    + `. Order–item join is ${formatPct(q.orderItemJoinPct)}.`
  );
}

export function computeQuality(input: {
  uniqueProducts: number;
  mappedProducts: number;
  itemRows: number;
  mappedItemRows: number;
  revenue: number;
  mappedRevenue: number;
  sessions: number;
  unclassifiedSessions: number;
  joinPct: number | null;
}): CommerceQuality {
  const sessions = input.sessions || 0;
  return {
    productUuidMappingPct: input.uniqueProducts ? input.mappedProducts / input.uniqueProducts : null,
    itemRowMappingPct: input.itemRows ? input.mappedItemRows / input.itemRows : null,
    revenueMappingPct: input.revenue ? input.mappedRevenue / input.revenue : null,
    confidentlyClassifiedSessionPct: sessions ? (sessions - input.unclassifiedSessions) / sessions : null,
    unclassifiedSessionPct: sessions ? input.unclassifiedSessions / sessions : null,
    orderItemJoinPct: input.joinPct,
  };
}
