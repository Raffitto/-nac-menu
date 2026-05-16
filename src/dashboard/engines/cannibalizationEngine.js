/** Detect likely menu item competition within similar groups */

const GROUP_PATTERNS = [
  { id: "burgers", re: /burger|smash|برجر/i, category: "daytime" },
  { id: "lemonades", re: /lemonade|mojito|موهيتو|ليمون/i, category: "drinks" },
  { id: "desserts", re: /dessert|cookie|cake|pavlova|toast|حلى/i, category: "desserts" },
  { id: "coffee", re: /coffee|latte|espresso|قهوة|لاتيه/i, category: "drinks" },
  { id: "pasta", re: /pasta|risotto|باستا/i, category: "evening" },
  { id: "salads", re: /salad|سلطة/i, category: "daytime" },
];

function groupForItem(name, categoryId) {
  for (const g of GROUP_PATTERNS) {
    if (g.re.test(name) || (categoryId && g.category === categoryId)) {
      return g.id;
    }
  }
  return null;
}

export function detectCannibalization(funnels = []) {
  if (!funnels.length) return { groups: [], risks: [] };

  const buckets = {};
  funnels.forEach((f) => {
    const g = groupForItem(f.item_name || "", f.category_id);
    if (!g) return;
    if (!buckets[g]) buckets[g] = [];
    buckets[g].push(f);
  });

  const groups = [];
  const risks = [];

  Object.entries(buckets).forEach(([groupId, items]) => {
    if (items.length < 2) return;

    const sortedImp = [...items].sort(
      (a, b) => (b.impressions ?? b.item_opens) - (a.impressions ?? a.item_opens),
    );
    const sortedOrders = [...items].sort((a, b) => (b.orders || 0) - (a.orders || 0));

    const dominant = sortedOrders[0];
    const weaker = sortedOrders[sortedOrders.length - 1];
    const splitImpressions = sortedImp.reduce((s, i) => s + (i.impressions ?? i.item_opens ?? 0), 0);

    const highOpensLowOrders = items.find(
      (i) => (i.item_opens || 0) >= 15 && (i.orders || 0) < 3,
    );
    const highOrdersOther = items.find(
      (i) => i !== highOpensLowOrders && (i.orders || 0) >= 8,
    );

    if (splitImpressions < 40) return;

    let recommendation = "Feature the dominant item; differentiate weaker items visually.";
    if (highOpensLowOrders && highOrdersOther) {
      recommendation = "Separate visually — one item draws attention while another converts in POS.";
    } else if (dominant.orders > weaker.orders * 2) {
      recommendation = `Feature "${dominant.item_name}"; reposition or bundle "${weaker.item_name}".`;
    }

    const entry = {
      competing_group: groupId,
      items: items.map((i) => i.item_name),
      dominant_item: dominant.item_name,
      weaker_item: weaker.item_name,
      recommendation,
      confidence: splitImpressions >= 80 ? "medium" : "low",
    };
    groups.push(entry);
    if (dominant.item_name !== weaker.item_name) {
      risks.push({
        title: `${groupId}: ${dominant.item_name} vs ${weaker.item_name}`,
        detail: recommendation,
        confidence: entry.confidence,
      });
    }
  });

  return { groups, risks };
}
