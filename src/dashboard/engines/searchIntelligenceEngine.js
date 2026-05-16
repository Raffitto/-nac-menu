/** Advanced search intelligence — typo clusters, friction, unmet demand */

const SYNONYM_CLUSTERS = [
  { keys: ["قش", "قشر", "قشطة", "cream", "kash"], intent: "cream / قشطة" },
  { keys: ["trufle", "truffle", "ترفل"], intent: "truffle" },
  { keys: ["passion", "passionfruit", "باشن"], intent: "passion fruit" },
  { keys: ["burger", "برجر", "smash"], intent: "burger" },
  { keys: ["mojito", "موهيتو", "lemonade", "ليموناضة"], intent: "refreshing drinks" },
  { keys: ["coffee", "قهوة", "latte", "لاتيه"], intent: "coffee" },
];

function normalizeQuery(q) {
  return String(q || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = cur;
    }
  }
  return row[b.length];
}

function clusterQueries(queries) {
  const used = new Set();
  const groups = [];
  queries.forEach((q1) => {
    if (used.has(q1.query)) return;
    const members = [q1];
    used.add(q1.query);
    queries.forEach((q2) => {
      if (used.has(q2.query) || q1.query === q2.query) return;
      if (levenshtein(q1.query, q2.query) <= 2 && q1.query.length >= 3) {
        members.push(q2);
        used.add(q2.query);
      }
    });
    groups.push(members);
  });
  return groups;
}

function matchSynonymCluster(query) {
  const q = normalizeQuery(query);
  for (const cluster of SYNONYM_CLUSTERS) {
    if (cluster.keys.some((k) => q.includes(k) || levenshtein(q, k) <= 1)) {
      return cluster;
    }
  }
  return null;
}

export function buildSearchIntelligence(biData) {
  const topSearches = (biData?.top_searches || []).map((s) => ({
    query: normalizeQuery(s.query),
    count: Number(s.count) || 0,
  }));
  const lostSearches = (biData?.lost_searches || []).map((s) => ({
    query: normalizeQuery(s.query || s.q),
    count: Number(s.sessions || s.count) || 0,
  }));

  const totalSearchEvents = Number(biData?.by_event_type?.search_used || 0) +
    Number(biData?.by_event_type?.search_submit || 0);

  const lostVolume = lostSearches.reduce((s, l) => s + l.count, 0);
  const searchFrictionScore = totalSearchEvents > 0
    ? Math.min(100, Math.round((lostVolume / totalSearchEvents) * 100))
    : lostSearches.length > 0 ? 40 : 0;

  const unmetDemandScore = Math.min(
    100,
    lostSearches.slice(0, 5).reduce((s, l) => s + Math.min(l.count * 8, 25), 0),
  );

  const synonymOpportunities = [];
  lostSearches.forEach((l) => {
    const cluster = matchSynonymCluster(l.query);
    if (cluster) {
      synonymOpportunities.push({
        query: l.query,
        count: l.count,
        intent: cluster.intent,
        action: "Search friction detected. Add Arabic/English synonyms so guest searches return stronger results.",
      });
    }
  });

  const typoGroups = clusterQueries(lostSearches).filter((g) => g.length > 1);

  const recommendedAliases = [
    ...synonymOpportunities.slice(0, 3).map((s) => ({
      title: `Synonym opportunity: ${s.intent}`,
      action: s.action,
      queries: [s.query],
    })),
    ...typoGroups.slice(0, 2).map((g) => ({
      title: `Typo cluster (${g.length} variants)`,
      action: "Guests spell similar terms differently — unify synonyms in Menu Manager search.",
      queries: g.map((x) => x.query),
    })),
  ];

  const insights = [];
  if (lostSearches.length > 0) {
    insights.push({
      type: "friction",
      severity: unmetDemandScore >= 50 ? "high" : "medium",
      message: "Search friction detected. Guests repeat terms that do not return strong results.",
      action: "Add Arabic/English synonyms in Menu Manager — do not duplicate menu items.",
    });
  }
  if (topSearches.length > 0) {
    insights.push({
      type: "success",
      message: `"${topSearches[0].query}" is the top successful search (${topSearches[0].count}×).`,
    });
  }

  return {
    topSuccessful: topSearches.slice(0, 8),
    topFailed: lostSearches.slice(0, 8),
    synonymOpportunities,
    typoGroups,
    unmetDemandScore,
    searchFrictionScore,
    recommendedAliases,
    insights,
    confidence: totalSearchEvents >= 20 ? "medium" : "low",
  };
}
