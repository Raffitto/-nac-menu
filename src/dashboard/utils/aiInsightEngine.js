import { formatDuration } from "./formatters";
import { buildRestaurantIntelligence } from "../engines/analyticsEngine";
import { answerForecastQuestion } from "../engines/forecastingEngine";
import { computeTrustConfidence, buildDataContext, clampMetric, hasVisibilityTracking } from "./intelligenceSanity";
import { normalizeTopItems } from "./topItemsNormalize";
import { BEHAVIOR, prefixSignal, buildExportCommentary } from "./itemBehaviorEngine";

const CATEGORY_LABELS = {
  breakfast: "Breakfast",
  brunch: "Brunch",
  daytime: "Daytime",
  evening: "Evening",
  desserts: "Desserts",
  drinks: "Drinks",
};

function catName(id) {
  if (!id) return null;
  return CATEGORY_LABELS[id] || null;
}

function pct(a, b) {
  if (!b || b === 0) return 0;
  return Math.round((a / b) * 100);
}

export function buildInsightCards(data) {
  if (!data || typeof data !== "object") return [];

  const cards = [];
  const byType = data.by_event_type || {};
  const totalSessions = Number(data.total_sessions) || 0;
  const qrStarts = Number(byType.qr_session_start) || 0;
  const itemOpens = Number(byType.item_open) || 0;
  const addOnClicks = Number(byType.add_on_click) || 0;
  const categoryOpens = Number(byType.category_open) || 0;
  const topItems = data.top_items || [];
  const topCategories = data.top_categories || [];
  const topAddonPairs = data.top_addon_pairs || [];
  const lostSearches = data.lost_searches || [];
  const deadZones = data.dead_zones || [];
  const sessionQuality = data.session_quality || {};
  const langBehavior = data.lang_behavior || {};
  const topSearches = data.top_searches || [];
  const returningSessions = Number(data.returning_sessions) || 0;
  const bounceSessions = Number(data.bounce_sessions) || 0;
  const avgTime = Number(data.avg_time_spent) || 0;

  const addOnRate = itemOpens > 0 ? (addOnClicks / itemOpens) * 100 : 0;
  const bounceRate = totalSessions > 0 ? (bounceSessions / totalSessions) * 100 : 0;
  const returningPct = qrStarts > 0 ? pct(returningSessions, qrStarts) : 0;

  // Revenue Opportunities
  if (addOnRate < 15 && itemOpens > 10) {
    cards.push({
      id: "addon-low",
      group: "Revenue Opportunities",
      title: "Add-on conversion is low",
      explanation: `Only ${addOnRate.toFixed(1)}% of item views lead to an add-on click. Guests see add-ons but do not engage.`,
      action: "Make add-on suggestions more visual. Add preview images, place them above the fold, and highlight savings.",
      whyMatters: "Every percentage point of add-on conversion directly increases average order value.",
      impact: { revenue: "high", ux: "medium", urgency: "This Week" },
      confidence: itemOpens > 50 ? "high" : "medium",
      severity: "high",
      source: "add_on_click / item_open ratio",
      metric: `${addOnClicks} clicks / ${itemOpens} item views = ${addOnRate.toFixed(1)}%`,
    });
  } else if (addOnRate >= 15 && itemOpens > 10) {
    cards.push({
      id: "addon-strong",
      group: "Revenue Opportunities",
      title: "Add-on conversion is healthy",
      explanation: `${addOnRate.toFixed(1)}% of item views convert to add-on clicks. Strong for hospitality.`,
      action: "Maintain current add-on visibility. Test premium upsells on top-converting items.",
      whyMatters: "Healthy add-on rates mean your upsell UX is working. Protect this advantage.",
      impact: { revenue: "low", ux: "low", urgency: "Monitor" },
      confidence: itemOpens > 50 ? "high" : "medium",
      severity: "low",
      source: "add_on_click / item_open ratio",
      metric: `${addOnClicks} clicks / ${itemOpens} views = ${addOnRate.toFixed(1)}%`,
    });
  }

  if (topAddonPairs.length > 0) {
    const best = topAddonPairs[0];
    if (best.item && best.addon) {
      cards.push({
        id: "best-addon-pair",
        group: "Revenue Opportunities",
        title: `Best add-on pair: ${best.item} + ${best.addon}`,
        explanation: "This combination has the highest conversion among all item/add-on pairs.",
        action: "Promote this pair visually. Consider bundling as a combo or highlighting with a badge.",
        whyMatters: "High-converting pairs prove what guests want together. Replicate this pattern.",
        impact: { revenue: "medium", ux: "low", urgency: "This Week" },
        confidence: "medium",
        severity: "low",
        source: "top_addon_pairs",
        metric: `Top pair by conversion count`,
      });
    }
  }

  // Desserts + add-on cross-insight
  if (topCategories.length > 0) {
    const dessertCat = topCategories.find((c) => c.id === "desserts");
    if (dessertCat && addOnRate < 12) {
      cards.push({
        id: "desserts-addon-gap",
        group: "Revenue Opportunities",
        title: "Desserts attract attention but add-on conversion is weak",
        explanation: `Desserts has ${dessertCat.opens} opens but overall add-on rate is only ${addOnRate.toFixed(1)}%. Opportunity to pair desserts with premium add-ons.`,
        action: "Add chocolate, syrup, or ice cream add-ons with preview images to dessert items.",
        whyMatters: "Desserts guests are already engaged — they just need a compelling upsell prompt.",
        impact: { revenue: "high", ux: "low", urgency: "This Week" },
        confidence: "medium",
        severity: "medium",
        source: "top_categories + add_on_rate",
        metric: `${dessertCat.opens} dessert opens, ${addOnRate.toFixed(1)}% add-on rate`,
      });
    }
  }

  // Menu Problems
  if (deadZones.length > 0) {
    const worst = deadZones.reduce((a, b) => {
      const aPct = Number(a.opens) > 0 ? Number(a.item_views || 0) / Number(a.opens) : 1;
      const bPct = Number(b.opens) > 0 ? Number(b.item_views || 0) / Number(b.opens) : 1;
      return aPct < bPct ? a : b;
    });
    const label = catName(worst.category || worst.id);
    const engPct = Number(worst.opens) > 0 ? pct(Number(worst.item_views || 0), Number(worst.opens)) : 0;
    if (label) {
      cards.push({
        id: "dead-zone",
        group: "Menu Problems",
        title: `${label} has low item engagement`,
        explanation: `Only ${engPct}% of guests who open ${label} actually view an item. They browse the category but nothing grabs them.`,
        action: "Redesign item thumbnails, improve descriptions, or feature a hero item at the top.",
        whyMatters: "Categories with high opens but low item views need better item positioning and visuals.",
        impact: { revenue: "high", ux: "high", urgency: "Today" },
        confidence: Number(worst.opens) > 20 ? "high" : "medium",
        severity: engPct < 30 ? "high" : "medium",
        source: "dead_zones (item_views / category_opens)",
        metric: `${worst.item_views || 0} item views / ${worst.opens} category opens = ${engPct}%`,
      });
    }
  }

  if (bounceRate > 30 && totalSessions > 10) {
    cards.push({
      id: "high-bounce",
      group: "Menu Problems",
      title: "High bounce rate",
      explanation: `${bounceRate.toFixed(0)}% of sessions end after 1–2 actions. Guests scan the QR but leave quickly.`,
      action: "Check QR placement. Ensure the landing page loads fast and the first category is immediately engaging.",
      whyMatters: "Every bounced session is a lost opportunity. Reducing bounce by 10% could increase orders.",
      impact: { revenue: "high", ux: "high", urgency: "Today" },
      confidence: totalSessions > 50 ? "high" : "medium",
      severity: bounceRate > 50 ? "high" : "medium",
      source: "bounce_sessions / total_sessions",
      metric: `${bounceSessions} bounced / ${totalSessions} total = ${bounceRate.toFixed(0)}%`,
    });
  }

  if (categoryOpens > 0 && itemOpens > 0 && (itemOpens / categoryOpens) < 0.5) {
    cards.push({
      id: "low-item-ratio",
      group: "Menu Problems",
      title: "Guests browse categories but rarely open items",
      explanation: `Only ${pct(itemOpens, categoryOpens)}% of category opens lead to an item view. Item cards may not be compelling enough.`,
      action: "Improve item card images and add short enticing descriptions visible in the category list.",
      whyMatters: "If guests see categories but skip items, the menu layout needs visual improvement.",
      impact: { revenue: "medium", ux: "high", urgency: "This Week" },
      confidence: categoryOpens > 30 ? "high" : "medium",
      severity: "medium",
      source: "item_open / category_open ratio",
      metric: `${itemOpens} item opens / ${categoryOpens} category opens`,
    });
  }

  // Guest Behavior
  if (avgTime > 0) {
    cards.push({
      id: "avg-session",
      group: "Guest Behavior",
      title: `Average session: ${formatDuration(avgTime)}`,
      explanation: avgTime > 120 ? "Guests spend significant time exploring — great engagement." : "Sessions are short. Guests make quick decisions or leave early.",
      action: avgTime > 120 ? "Leverage longer sessions with strategic upsell prompts." : "Add engaging visuals or seasonal highlights to extend browsing.",
      whyMatters: "Session duration correlates with order size. Longer browsing = more items considered.",
      impact: { revenue: avgTime < 60 ? "medium" : "low", ux: "medium", urgency: avgTime < 60 ? "This Week" : "Monitor" },
      confidence: totalSessions > 20 ? "high" : "medium",
      severity: avgTime < 60 ? "medium" : "low",
      source: "avg_time_spent",
      metric: `${formatDuration(avgTime)} across ${totalSessions} sessions`,
    });
  }

  if (returningPct > 0) {
    cards.push({
      id: "returning",
      group: "Guest Behavior",
      title: `${returningPct}% returning guests`,
      explanation: returningPct > 25 ? "Strong loyalty — guests come back regularly." : "Most guests are first-time visitors. Focus on first impressions.",
      action: returningPct > 25 ? "Reward loyalty with seasonal specials or VIP items." : "Improve the first visit experience to encourage returns.",
      whyMatters: "Returning guests spend more and require less convincing. Building loyalty is high-value.",
      impact: { revenue: "medium", ux: "low", urgency: "Monitor" },
      confidence: qrStarts > 30 ? "high" : "medium",
      severity: "low",
      source: "returning_sessions / qr_session_start",
      metric: `${returningSessions} returning / ${qrStarts} total starts = ${returningPct}%`,
    });
  }

  if (sessionQuality) {
    const power = Number(sessionQuality.power) || 0;
    const deep = Number(sessionQuality.deep) || 0;
    const engaged = power + deep;
    if (engaged > 0 && totalSessions > 0) {
      const engagedPct = pct(engaged, totalSessions);
      cards.push({
        id: "power-users",
        group: "Guest Behavior",
        title: `${engagedPct}% deeply engaged guests`,
        explanation: `${engaged} sessions showed deep/power-level exploration (8+ events). These are your most interested guests.`,
        action: "Identify what these guests have in common (category, time, language) and optimize for them.",
        whyMatters: "Power users are your advocates. They explore deeply and are most likely to order high-value items.",
        impact: { revenue: "medium", ux: "low", urgency: "Monitor" },
        confidence: totalSessions > 30 ? "high" : "medium",
        severity: "low",
        source: "session_quality (deep + power)",
        metric: `${engaged} engaged sessions / ${totalSessions} total`,
      });
    }
  }

  // Search Intent
  if (lostSearches.length > 0) {
    const top = lostSearches[0];
    const query = top.query || top.term || top.q || "";
    const count = Number(top.count) || Number(top.searches) || 0;
    if (query) {
      cards.push({
        id: "lost-search-1",
        group: "Search Intent",
        title: `Guests searched "${query}"${count > 1 ? ` ${count} times` : ""} — not found`,
        explanation: "This search returned no results. Guests want something you may not offer or named differently.",
        action: "Guests repeatedly search for terms that do not return strong results. Add Arabic/English synonyms in Menu Manager to improve search success.",
        whyMatters: "High search activity around specific terms means guests expect to find those items easily.",
        impact: { revenue: "high", ux: "medium", urgency: count > 5 ? "Today" : "This Week" },
        confidence: count > 3 ? "high" : "medium",
        severity: count > 5 ? "high" : "medium",
        source: "lost_searches",
        metric: `"${query}" searched ${count} time${count !== 1 ? "s" : ""} with 0 results`,
      });
    }
    if (lostSearches.length > 1) {
      const second = lostSearches[1];
      const q2 = second.query || second.term || second.q || "";
      const c2 = Number(second.count) || Number(second.searches) || 0;
      if (q2) {
        cards.push({
          id: "lost-search-2",
          group: "Search Intent",
          title: `Also searched: "${q2}"${c2 > 1 ? ` (${c2}×)` : ""}`,
          explanation: "Another unmet search query worth investigating.",
          action: `Evaluate if "${q2}" represents a gap in your menu or a naming issue.`,
          whyMatters: "Multiple unmet searches signal systematic gaps in your menu coverage.",
          impact: { revenue: "medium", ux: "medium", urgency: "This Week" },
          confidence: "medium",
          severity: "medium",
          source: "lost_searches",
          metric: `"${q2}" searched ${c2} time${c2 !== 1 ? "s" : ""}`,
        });
      }
    }
  }

  if (topSearches.length > 0 && lostSearches.length === 0) {
    cards.push({
      id: "search-healthy",
      group: "Search Intent",
      title: "All searches find results",
      explanation: "No lost searches detected. Your menu naming aligns with guest expectations.",
      action: "Continue monitoring. Add new items with guest-friendly names.",
      whyMatters: "Good search alignment means less friction between desire and discovery.",
      impact: { revenue: "low", ux: "low", urgency: "Monitor" },
      confidence: "medium",
      severity: "low",
      source: "top_searches / lost_searches",
      metric: `${topSearches.length} successful search patterns`,
    });
  }

  // Language Behavior
  const enData = langBehavior.en;
  const arData = langBehavior.ar;
  if (enData && arData) {
    const enAvg = Number(enData.avg_events) || 0;
    const arAvg = Number(arData.avg_events) || 0;
    const enDur = Number(enData.avg_duration) || 0;
    const arDur = Number(arData.avg_duration) || 0;
    const byLang = data.by_language || {};
    const enCount = Number(byLang.en) || 0;
    const arCount = Number(byLang.ar) || 0;
    const totalLang = enCount + arCount;
    const arPct = totalLang > 0 ? pct(arCount, totalLang) : 0;

    const dominant = arPct > 50 ? "Arabic" : "English";
    cards.push({
      id: "lang-split",
      group: "Language Behavior",
      title: `${arPct}% Arabic / ${100 - arPct}% English`,
      explanation: arPct > 60 ? "Arabic-speaking guests dominate menu activity. Arabic UX should stay priority." : arPct < 30 ? "Most guests prefer English. Ensure English copy is polished." : "Balanced bilingual audience. Both languages matter equally.",
      action: arPct > 60 ? "Invest in Arabic descriptions, ensure RTL layout is flawless." : arPct < 30 ? "Focus English descriptions but keep Arabic accurate." : "Maintain both languages at equal quality.",
      whyMatters: `${dominant} is the primary interface for ${Math.max(arPct, 100 - arPct)}% of your guests.`,
      impact: { revenue: "medium", ux: "high", urgency: "This Week" },
      confidence: totalLang > 30 ? "high" : "medium",
      severity: "low",
      source: "by_language",
      metric: `${arCount} Arabic events / ${enCount} English events`,
    });

    if (enAvg > 0 && arAvg > 0 && Math.abs(enAvg - arAvg) > 1) {
      const more = arAvg > enAvg ? "Arabic" : "English";
      const diff = Math.round(Math.abs(arAvg - enAvg));
      cards.push({
        id: "lang-engagement",
        group: "Language Behavior",
        title: `${more} users explore ${diff} more items per session`,
        explanation: `${more}-speaking guests are more engaged. May indicate better content quality for that language.`,
        action: "Improve content for the less-engaged language. Consider A/B testing descriptions.",
        whyMatters: "Engagement gap between languages reveals where content needs improvement.",
        impact: { revenue: "low", ux: "medium", urgency: "This Week" },
        confidence: "medium",
        severity: "low",
        source: "lang_behavior (avg_events)",
        metric: `Arabic: ${arAvg.toFixed(1)} events/session, English: ${enAvg.toFixed(1)} events/session`,
      });
    }

    if (enDur > 0 && arDur > 0) {
      const longer = arDur > enDur ? "Arabic" : "English";
      cards.push({
        id: "lang-duration",
        group: "Language Behavior",
        title: `${longer} sessions last longer (${formatDuration(Math.max(enDur, arDur))})`,
        explanation: "Longer sessions indicate deeper exploration or slower decision-making.",
        action: "Use this for staffing decisions (language preference by time of day).",
        whyMatters: "Understanding browsing patterns by language helps optimize service timing.",
        impact: { revenue: "low", ux: "low", urgency: "Monitor" },
        confidence: "medium",
        severity: "low",
        source: "lang_behavior (avg_duration)",
        metric: `Arabic: ${formatDuration(arDur)}, English: ${formatDuration(enDur)}`,
      });
    }
  }

  // Add-on Opportunities
  if (topAddonPairs.length > 2) {
    const underperforming = topAddonPairs[topAddonPairs.length - 1];
    if (underperforming?.item && underperforming?.addon) {
      cards.push({
        id: "addon-weak",
        group: "Add-on Opportunities",
        title: `Weak pairing: ${underperforming.item} + ${underperforming.addon}`,
        explanation: "This add-on pairing has very low engagement despite being offered.",
        action: "Replace it with a more relevant option or improve its presentation.",
        whyMatters: "Weak pairings clutter the menu and waste upsell real estate.",
        impact: { revenue: "medium", ux: "low", urgency: "This Week" },
        confidence: "medium",
        severity: "medium",
        source: "top_addon_pairs (lowest)",
        metric: "Lowest conversion among tracked pairs",
      });
    }
  }

  if (addOnClicks > 0 && topItems.length > 0) {
    const popularNoAddon = topItems.find((item) => {
      const hasAddon = topAddonPairs.some((p) => p.item === item.name);
      return !hasAddon && Number(item.opens) > 5;
    });
    if (popularNoAddon) {
      cards.push({
        id: "addon-opportunity",
        group: "Add-on Opportunities",
        title: `${popularNoAddon.name} has no add-on engagement`,
        explanation: `Popular item (${popularNoAddon.opens} opens) but no one clicks its add-ons.`,
        action: "Add more compelling add-on options or improve their visibility for this item.",
        whyMatters: "Popular items with zero add-on engagement represent missed revenue every session.",
        impact: { revenue: "high", ux: "low", urgency: "This Week" },
        confidence: "medium",
        severity: "medium",
        source: "top_items vs top_addon_pairs",
        metric: `${popularNoAddon.opens} opens, 0 add-on clicks`,
      });
    }
  }

  return cards;
}

/** Insight cards from latest Foodics import + visibility vs sales */
export function buildFoodicsInsightCards(foodics) {
  if (!foodics?.hasImports || !foodics.conversionRows?.length) return [];

  const cards = [];
  const opps = foodics.opportunities || {};
  const hiLo = opps.highClicksLowOrders?.[0];
  const loHi = opps.highOrdersLowClicks?.[0];
  const bestConv = opps.bestConversion?.[0];

  if (hiLo) {
    cards.push({
      id: "foodics-hi-lo",
      group: "Revenue Opportunities",
      title: `${hiLo.item_name}: high menu interest, weaker orders`,
      explanation: `${hiLo.item_impressions ?? hiLo.item_views} impressions and ${hiLo.quantity_sold} Foodics orders. ${hiLo.conversion_display || `${hiLo.impression_conversion_pct ?? hiLo.menu_conversion_pct ?? hiLo.conversion_rate}% visibility-to-sales`}.`,
      action: hiLo.suggestion,
      whyMatters: "Digital attention is not converting to POS sales for this item.",
      impact: { revenue: "high", ux: "medium", urgency: "This Week" },
      confidence: hiLo.item_views > 30 ? "high" : "medium",
      severity: "high",
      source: "Foodics + item_open",
      metric: `${hiLo.quantity_sold} orders / ${hiLo.item_views} views`,
    });
  }

  if (loHi) {
    cards.push({
      id: "foodics-lo-hi",
      group: "Revenue Opportunities",
      title: `${loHi.item_name}: sells well but low menu visibility`,
      explanation: `${loHi.quantity_sold} orders from Foodics but only ${loHi.item_impressions ?? loHi.item_views} impressions.`,
      action: loHi.suggestion,
      whyMatters: "Offline demand exists — digital menu is under-promoting a winner.",
      impact: { revenue: "high", ux: "high", urgency: "This Week" },
      confidence: "medium",
      severity: "medium",
      source: "Foodics + item_open",
      metric: `${loHi.item_views} views / ${loHi.quantity_sold} orders`,
    });
  }

  if (bestConv) {
    cards.push({
      id: "foodics-best-conv",
      group: "Guest Behavior",
      title: `Strong converter: ${bestConv.item_name}`,
      explanation: `${bestConv.impression_conversion_pct ?? bestConv.menu_conversion_pct ?? bestConv.conversion_rate}% visibility-to-sales with ${bestConv.net_sales?.toFixed?.(0) ?? bestConv.net_sales} SAR net sales.`,
      action: "Feature this item and replicate its presentation on weaker items.",
      whyMatters: "Proven path from browse to purchase.",
      impact: { revenue: "medium", ux: "low", urgency: "Monitor" },
      confidence: "high",
      severity: "low",
      source: "conversion_rate",
      metric: `${bestConv.conversion_rate}% conversion`,
    });
  }

  return cards;
}

/** Visibility-first insight cards (impressions + opens + Foodics) */
export function buildVisibilityInsightCards(data, foodics = null) {
  const cards = [];
  const topItems = normalizeTopItems(data?.top_items || []);
  const visibilityReady = hasVisibilityTracking(topItems, data?.by_event_type);

  if (!visibilityReady && topItems.length > 0) {
    cards.push({
      id: "visibility-collecting",
      group: "Guest Behavior",
      title: "Visibility tracking is warming up",
      explanation:
        "Collecting visibility signals — impression data will sharpen guest attention metrics. Until then, deep interest (opens) is used as a fallback.",
      action: "Keep the guest menu live — passive impressions will sharpen visibility vs sales within a few days.",
      whyMatters: "Accurate visibility separates glance-at-menu from true disinterest.",
      impact: { revenue: "low", ux: "medium", urgency: "Monitor" },
      confidence: "low",
      severity: "low",
      source: "item_impression",
      metric: "collecting",
    });
    return cards;
  }

  const visualConfidence = topItems
    .filter((t) => t.impressions >= 25 && t.opens > 0 && t.opens / t.impressions < 0.12)
    .sort((a, b) => b.impressions - a.impressions)[0];

  if (visualConfidence) {
    cards.push({
      id: "vis-visual-confidence",
      group: "Guest Behavior",
      title: `${visualConfidence.name}: seen, rarely opened`,
      explanation: `Guests frequently view ${visualConfidence.name} without opening details (${visualConfidence.impressions} impressions, ${visualConfidence.opens} opens), suggesting the visual presentation already builds confidence.`,
      action: "Keep hero imagery strong; test subtle CTA only if you want more add-on or modifier discovery.",
      whyMatters: "Self-explanatory items need less modal friction.",
      impact: { revenue: "medium", ux: "high", urgency: "Monitor" },
      confidence: visualConfidence.impressions > 40 ? "high" : "medium",
      severity: "low",
      source: "item_impression / item_open",
      metric: `${Math.round((visualConfidence.opens / visualConfidence.impressions) * 100)}% open rate`,
    });
  }

  const star = topItems
    .filter((t) => t.impressions >= 20 && t.opens >= 5)
    .sort((a, b) => b.impressions - a.impressions)[0];

  if (star && foodics?.conversionRows?.length) {
    const row = foodics.conversionRows.find(
      (r) => r.item_name?.toLowerCase() === star.name?.toLowerCase(),
    );
    if (row && (row.impression_conversion_pct ?? 0) >= 8) {
      cards.push({
        id: "vis-star",
        group: "Revenue Opportunities",
        title: `${star.name}: efficient visibility-to-sales`,
        explanation: `${star.name} receives strong impressions (${star.impressions}) and strong sales, indicating highly efficient menu placement.`,
        action: row.suggestion || "Protect placement and replicate presentation on weaker items.",
        whyMatters: "High visibility plus conversion is the ideal menu outcome.",
        impact: { revenue: "high", ux: "medium", urgency: "This Week" },
        confidence: "high",
        severity: "low",
        source: "item_impression + Foodics",
        metric: `${row.impression_conversion_pct}% impression conversion`,
      });
    }
  }

  const habitual = (foodics?.conversionRows || []).find(
    (r) => (r.item_impressions || 0) < 8 && r.quantity_sold >= 12,
  );
  if (habitual) {
    cards.push({
      id: "vis-habitual",
      group: "Revenue Opportunities",
      title: `${habitual.item_name}: habitual ordering`,
      explanation: `Some items like ${habitual.item_name} convert with almost no menu interaction (${habitual.quantity_sold} orders, ${habitual.item_impressions || 0} impressions), suggesting habitual ordering behavior.`,
      action: habitual.suggestion,
      whyMatters: "Waiter-driven and repeat-order items are under-counted by click-only metrics.",
      impact: { revenue: "high", ux: "low", urgency: "This Week" },
      confidence: "medium",
      severity: "medium",
      source: "Foodics + item_impression",
      metric: `${habitual.quantity_sold} orders`,
    });
  }

  const dessertTrap = topItems.find(
    (t) =>
      t.name &&
      /dessert|cookie|pavlova|toast|cake/i.test(t.name) &&
      t.impressions >= 15 &&
      t.opens > 0 &&
      t.opens / t.impressions < 0.15
  );
  if (dessertTrap) {
    cards.push({
      id: "vis-dessert-attention",
      group: "Menu Problems",
      title: `${dessertTrap.name}: visual attention, weaker deep engagement`,
      explanation: `Dessert-style items such as ${dessertTrap.name} generate strong visual attention (${dessertTrap.impressions} impressions) but weaker deep engagement (${dessertTrap.opens} opens).`,
      action: "Test shorter descriptions, bundle pricing, or staff dessert prompts.",
      whyMatters: "Guests notice desserts; the gap is moving from browse to order.",
      impact: { revenue: "medium", ux: "medium", urgency: "This Week" },
      confidence: "medium",
      severity: "medium",
      source: "item_impression",
      metric: `${Math.round((dessertTrap.opens / dessertTrap.impressions) * 100)}% deep interest`,
    });
  }

  const menuTrap = (foodics?.conversionRows || []).find(
    (r) => (r.item_impressions || r.item_views || 0) >= 25 && (r.impression_conversion_pct ?? 100) < 5,
  );
  if (menuTrap) {
    cards.push({
      id: "vis-menu-trap",
      group: "Menu Problems",
      title: prefixSignal(menuTrap.signal_strength, `${menuTrap.item_name}: attention without sales`),
      explanation: `${menuTrap.item_name} draws visibility (${menuTrap.item_impressions || menuTrap.item_views} impressions) but weak sales conversion (${menuTrap.impression_conversion_pct ?? 0}%). Zero opens does not mean zero interest — guests may still be evaluating.`,
      action: menuTrap.suggestion,
      whyMatters: "High visibility with weak sales wastes prime menu real estate.",
      impact: { revenue: "high", ux: "high", urgency: "Today" },
      confidence: "high",
      severity: "high",
      source: "item_impression + Foodics",
      metric: `${menuTrap.impression_conversion_pct}% impression conversion`,
    });
  }

  return cards;
}

export function buildManagementSummary(data) {
  if (!data) return null;

  const byType = data.by_event_type || {};
  const totalSessions = Number(data.total_sessions) || 0;
  const totalEvents = Number(data.total_events) || 0;
  const qrStarts = Number(byType.qr_session_start) || 0;
  const itemOpens = Number(byType.item_open) || 0;
  const addOnClicks = Number(byType.add_on_click) || 0;
  const topCategories = data.top_categories || [];
  const lostSearches = data.lost_searches || [];
  const deadZones = data.dead_zones || [];
  const bounceSessions = Number(data.bounce_sessions) || 0;
  const returningSessions = Number(data.returning_sessions) || 0;
  const avgTime = Number(data.avg_time_spent) || 0;
  const addOnRate = itemOpens > 0 ? ((addOnClicks / itemOpens) * 100).toFixed(1) : "0";
  const bounceRate = totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0;
  const returningRate = qrStarts > 0 ? Math.round((returningSessions / qrStarts) * 100) : 0;

  const working = [];
  const weak = [];
  const improve = [];
  const monitor = [];

  if (topCategories.length > 0) {
    const label = catName(topCategories[0].id);
    if (label) working.push(`${label} is the most engaged category.`);
  }
  if (Number(addOnRate) > 10) working.push(`Add-on conversion at ${addOnRate}% — guests engage with upsells.`);
  if (returningRate > 20) working.push(`${returningRate}% returning guests — loyalty is building.`);
  if (avgTime > 120) working.push(`Average session ${formatDuration(avgTime)} — guests explore deeply.`);

  if (bounceRate > 30) weak.push(`${bounceRate}% bounce rate — too many guests leave quickly.`);
  if (Number(addOnRate) < 10) weak.push(`Add-on conversion only ${addOnRate}% — upsell is underperforming.`);
  if (deadZones.length > 0) {
    const worstDz = deadZones[0];
    const dzLabel = catName(worstDz.category || worstDz.id);
    if (dzLabel) weak.push(`${dzLabel} has low item engagement.`);
  }
  if (avgTime < 60 && totalSessions > 10) weak.push(`Short sessions (${formatDuration(avgTime)}) — guests not browsing enough.`);

  if (lostSearches.length > 0) {
    improve.push("Search friction detected — add Arabic/English synonyms so repeated guest terms return strong results.");
  }
  if (Number(addOnRate) < 10) improve.push("Improve add-on visibility with preview images and better positioning.");
  if (bounceRate > 30) improve.push("Improve landing experience — faster load, better hero category.");

  monitor.push("Search queries for new demand signals.");
  monitor.push("Add-on conversion trend week over week.");
  if (deadZones.length > 0) monitor.push("Dead zone categories after any menu changes.");

  return {
    working,
    weak,
    needsAttention: weak,
    improve,
    monitor,
    qrStarts,
    totalSessions,
    totalEvents,
    avgTime,
    addOnRate,
    bounceRate,
    returningRate,
  };
}

export function getBestAction(data) {
  if (!data) return null;

  const lostSearches = data.lost_searches || [];
  const deadZones = data.dead_zones || [];
  const byType = data.by_event_type || {};
  const itemOpens = Number(byType.item_open) || 0;
  const addOnClicks = Number(byType.add_on_click) || 0;
  const totalSessions = Number(data.total_sessions) || 0;
  const bounceSessions = Number(data.bounce_sessions) || 0;
  const addOnRate = itemOpens > 0 ? (addOnClicks / itemOpens) * 100 : 0;
  const bounceRate = totalSessions > 0 ? (bounceSessions / totalSessions) * 100 : 0;

  if (lostSearches.length > 0) {
    const top = lostSearches[0];
    const q = top.query || top.term || top.q;
    const count = Number(top.count) || Number(top.searches) || 0;
    if (q && count > 2) {
      return {
        action: "Address search friction: guests repeat terms that do not return strong results. Add Arabic/English synonyms in Menu Manager.",
        reason: `Repeated searches (${count}×) signal demand that the menu is not surfacing clearly.`,
        source: "lost_searches",
        urgency: "Today",
      };
    }
  }

  if (bounceRate > 40 && totalSessions > 10) {
    return {
      action: "Fix the landing experience. Too many guests leave within seconds of scanning.",
      reason: `${bounceRate.toFixed(0)}% bounce rate means you're losing guests before they even browse.`,
      source: "bounce_sessions",
      urgency: "Today",
    };
  }

  if (addOnRate < 8 && itemOpens > 20) {
    return {
      action: "Add preview images to your top add-ons. Visual cues drive clicks.",
      reason: `Only ${addOnRate.toFixed(1)}% add-on conversion — significant revenue left on the table.`,
      source: "add_on_click / item_open",
      urgency: "This Week",
    };
  }

  if (deadZones.length > 0) {
    const worst = deadZones[0];
    const label = catName(worst.category || worst.id);
    if (label) {
      return {
        action: `Redesign ${label} category — add better photos and a featured hero item.`,
        reason: "Guests open this category but don't click any item.",
        source: "dead_zones",
        urgency: "This Week",
      };
    }
  }

  return {
    action: "Keep monitoring. Your menu is performing well across key metrics.",
    reason: "No critical issues detected in current data.",
    source: "overall analysis",
    urgency: "Monitor",
  };
}

function formatHour12(hour) {
  const h = Number(hour);
  if (Number.isNaN(h)) return null;
  const period = h >= 12 ? "PM" : "AM";
  const display = h % 12 || 12;
  return `${display} ${period}`;
}

function periodLabel(hours) {
  if (hours === 24) return "Today";
  if (hours === 168) return "Last 7 days";
  if (hours === 720) return "Last 30 days";
  return "All time";
}

const INTENT_SOURCE_METRICS = {
  time_peak: ["by_hour", "strongest_hour", "qr_session_start"],
  foodics: ["foodics_sales", "item_open", "conversion_rows"],
  management: ["executive_summary", "kpis"],
  search: ["lost_searches", "top_searches"],
  language: ["by_language", "lang_behavior"],
  addon: ["add_on_click", "item_open"],
  session: ["bounce_sessions", "total_sessions"],
  category: ["top_categories", "dead_zones"],
  item: ["top_items", "foodics_conversion"],
  improve_today: ["priority_rules"],
  forecast: ["forecastingEngine"],
  revenue: ["revenue_per_view", "foodics"],
  comparison: ["order_trend_pct", "foodics_batches"],
  fallback: [],
};

const ROUTING_CONFLICTS = {
  time_peak: /\b(category|foodics|search|language|add-?on|revenue|forecast)\b/,
  category: /\b(peak hour|what time|foodics|forecast)\b/,
  foodics: /\b(peak hour|bounce rate|language)\b/,
  language: /\b(foodics|category|peak hour)\b/,
  search: /\b(foodics|peak hour)\b/,
  management: /\b(peak hour|which item|forecast)\b/,
  forecast: /\b(bounce|category weak)\b/,
  revenue: /\b(peak hour|bounce)\b/,
};

function enrichResponse(response, data, foodics, intentDebug) {
  const events = Number(data?.total_events) || 0;
  const sessions = Number(data?.total_sessions) || 0;
  const trust = computeTrustConfidence({
    baseLevel: response.confidence,
    sampleSize: events,
    hasHistory: Boolean(foodics?.previousBatch),
    hasFoodics: Boolean(foodics?.hasImports),
  });
  const dataContext = buildDataContext({
    events,
    sessions,
    period: response.period,
    foodicsBatch: Boolean(foodics?.previousBatch),
  });
  if (process.env.NODE_ENV === "development" && intentDebug) {
    // eslint-disable-next-line no-console
    console.debug("[AI Insights routing]", intentDebug);
  }
  return {
    ...response,
    confidence: trust.level,
    trustPhrase: trust.phrase,
    dataContext,
  };
}

function metaResponse({ answer, confidence, intent, metric, periodHours = 0 }) {
  return {
    answer,
    confidence,
    intent,
    metric,
    period: periodLabel(periodHours),
  };
}

function convLabel(row) {
  if (row.trust_label && row.offline_driven) return row.trust_label;
  const pct = clampMetric(row.impression_conversion_pct ?? row.menu_conversion_pct ?? row.conversion_rate, 0, 100);
  const imp = row.item_impressions ?? row.item_views;
  const opens = row.item_modal_opens;
  if (imp > 0 && opens != null) {
    return `${pct}% impression conversion (${opens} opens / ${imp} impressions)`;
  }
  return `${pct}% impression conversion`;
}

function resolvePeakHour(data) {
  const byHour = data.by_hour || [];
  const byType = data.by_event_type || {};
  const qrScans = Number(byType.qr_session_start) || 0;

  if (byHour.length > 0) {
    let best = byHour[0];
    for (const row of byHour) {
      if (Number(row.count) > Number(best.count)) best = row;
    }
    const d = best.hour ? new Date(best.hour) : null;
    const label = d && !Number.isNaN(d.getTime())
      ? d.toLocaleString(undefined, { hour: "numeric", hour12: true })
      : formatHour12(data.strongest_hour) || "peak hour";
    return { label, count: Number(best.count), metric: "by_hour (menu activity)" };
  }

  if (data.strongest_hour != null && data.strongest_hour !== "") {
    const label = formatHour12(data.strongest_hour);
    return {
      label: label || String(data.strongest_hour),
      count: qrScans || Number(data.total_events) || 0,
      metric: "strongest_hour + qr_session_start",
    };
  }

  return null;
}

const INTENT_RULES = [
  {
    id: "time_peak",
    score(q) {
      let s = 0;
      if (/\b(what time|which hour|busiest hour|peak hour|peak time|busiest time)\b/.test(q)) s += 12;
      if (/\b(when do|when are|when is).*(scan|qr|guest|busy)\b/.test(q)) s += 10;
      if (/\b(most scans|most qr|qr.*most|scan.*most)\b/.test(q)) s += 10;
      if (/\b(hour|time|morning|afternoon|evening|night|pm|am)\b/.test(q)) s += 4;
      if (/\b(busy|busiest|peak)\b/.test(q)) s += 3;
      return s;
    },
  },
  {
    id: "visibility",
    score(q) {
      let s = 0;
      if (/\b(sell visually|visual seller|visual efficiency|photo.*work|card.*sell|which item photo)\b/.test(q)) s += 14;
      if (/\b(need more explanation|more detail|deep interest|guests investigate)\b/.test(q)) s += 12;
      if (/\b(waiter.?driven|staff recommend|habitual order|habit order|offline seller)\b/.test(q)) s += 13;
      if (/\b(attract.*attention|attention.*don.?t sell|menu trap|visibility.*not sell|high attention.*low)\b/.test(q)) s += 13;
      if (/\b(impression|visibility vs|guest attention|passive exposure)\b/.test(q)) s += 6;
      return s;
    },
  },
  {
    id: "foodics",
    score(q) {
      let s = 0;
      if (/\b(foodics|pos sales|sold offline|orders vs|revenue per)\b/.test(q)) s += 12;
      if (/\b(high clicks.*low orders|high attention.*low sales|low visibility.*high sales)\b/.test(q)) s += 11;
      if (/\b(selling well|wasting menu|best conversion|worst conversion|visibility vs sales)\b/.test(q)) s += 8;
      if (/\b(this week sales|foodics show)\b/.test(q)) s += 9;
      return s;
    },
  },
  {
    id: "management",
    score(q) {
      let s = 0;
      if (/\b(management|executive|meeting|tell management|30 second|brief)\b/.test(q)) s += 10;
      if (/\b(summary|report)\b/.test(q) && !/\b(search)\b/.test(q)) s += 6;
      return s;
    },
  },
  {
    id: "search",
    score(q) {
      let s = 0;
      if (/\b(search|searched|searching|looking for)\b/.test(q)) s += 8;
      if (/\b(not offer|don't have|do not have|missing item|unmet)\b/.test(q)) s += 9;
      if (/\b(lost search|no results)\b/.test(q)) s += 10;
      return s;
    },
  },
  {
    id: "language",
    score(q) {
      let s = 0;
      if (/\b(arabic|english|language|bilingual|rtl)\b/.test(q)) s += 9;
      if (/\b(lang)\b/.test(q) && !/\b(slang)\b/.test(q)) s += 4;
      return s;
    },
  },
  {
    id: "addon",
    score(q) {
      let s = 0;
      if (/\b(add-?on|upsell|pairing)\b/.test(q)) s += 9;
      if (/\b(conversion).*(add|upsell)\b/.test(q)) s += 7;
      return s;
    },
  },
  {
    id: "session",
    score(q) {
      let s = 0;
      if (/\b(bounce|bouncing)\b/.test(q)) s += 10;
      if (/\b(session|engaged|engagement|spend time|time spent|duration)\b/.test(q)) s += 7;
      if (/\b(power user|deep session|casual)\b/.test(q)) s += 8;
      return s;
    },
  },
  {
    id: "category",
    score(q) {
      let s = 0;
      if (/\b(category|categories|section|dead zone)\b/.test(q)) s += 8;
      if (/\b(strongest|weakest|weak|worst|dead)\b/.test(q) && /\b(category|section)\b/.test(q)) s += 10;
      if (/\b(which category)\b/.test(q)) s += 9;
      return s;
    },
  },
  {
    id: "item",
    score(q) {
      let s = 0;
      if (/\b(menu item|dish|item)\b/.test(q)) s += 5;
      if (/\b(promote|promotion|highlight|push)\b/.test(q)) s += 8;
      if (/\b(most viewed|top item|popular item|high impression|most impressions)\b/.test(q)) s += 9;
      if (/\b(viewed|views|opens)\b/.test(q) && /\b(item)\b/.test(q)) s += 6;
      return s;
    },
  },
  {
    id: "improve_today",
    score(q) {
      let s = 0;
      if (/\b(what should i improve|improve today|what to do today|priority today)\b/.test(q)) s += 10;
      if (/\b(improve)\b/.test(q) && /\b(today)\b/.test(q)) s += 8;
      return s;
    },
  },
  {
    id: "forecast",
    score(q) {
      let s = 0;
      if (/\b(forecast|predict|next week|trending|declining|likely to)\b/.test(q)) s += 10;
      if (/\b(trend|projection|outlook)\b/.test(q)) s += 7;
      return s;
    },
  },
  {
    id: "revenue",
    score(q) {
      let s = 0;
      if (/\b(revenue|sales|sar|profit|money)\b/.test(q)) s += 9;
      if (/\b(per view|revenue per)\b/.test(q)) s += 8;
      return s;
    },
  },
  {
    id: "comparison",
    score(q) {
      let s = 0;
      if (/\b(compare|vs|versus|changed|change from|what changed)\b/.test(q)) s += 9;
      if (/\b(difference|delta|period over)\b/.test(q)) s += 7;
      return s;
    },
  },
];

function detectIntent(question) {
  const q = question.toLowerCase().trim();
  const scored = INTENT_RULES.map((rule) => {
    let score = rule.score(q);
    const conflict = ROUTING_CONFLICTS[rule.id];
    if (conflict?.test(q)) score -= 6;
    return { id: rule.id, score: Math.max(0, score) };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const MIN_SCORE = 5;
  let intent = "fallback";
  let score = 0;

  if (scored.length && scored[0].score >= MIN_SCORE) {
    intent = scored[0].id;
    score = scored[0].score;
    if (scored.length > 1 && scored[0].score - scored[1].score <= 1) {
      const timeFirst = scored.find((s) => s.id === "time_peak");
      if (timeFirst && /\b(hour|time|peak|scan)\b/.test(q) && timeFirst.score >= scored[0].score - 1) {
        intent = "time_peak";
        score = timeFirst.score;
      }
    }
  }

  const routingConfidence = score >= 10 ? "high" : score >= 6 ? "medium" : "low";
  const intent_debug = {
    detected_intent: intent,
    matched_keywords: scored.slice(0, 3).map((s) => s.id),
    confidence: routingConfidence,
    source_metrics: INTENT_SOURCE_METRICS[intent] || [],
    scores: scored.slice(0, 5),
  };

  return { intent, score, intent_debug };
}

function answerTimePeak(data, periodHours) {
  const peak = resolvePeakHour(data);
  const byType = data.by_event_type || {};
  const qrScans = Number(byType.qr_session_start) || 0;
  if (!peak) {
    return metaResponse({
      answer: "Not enough hourly activity data yet. Collect more sessions across different times of day.",
      confidence: "low",
      intent: "time_peak",
      metric: "by_hour / strongest_hour",
      periodHours,
    });
  }
  const scanNote = qrScans > 0 ? ` There were ${qrScans} QR session starts in this period.` : "";
  return metaResponse({
    answer: `Most menu activity happened around ${peak.label} with ${peak.count} events in that hour bucket.${scanNote}`,
    confidence: peak.count > 10 ? "high" : "medium",
    intent: "time_peak",
    metric: peak.metric,
    periodHours,
  });
}

function answerCategory(data, q, periodHours) {
  const topCategories = data.top_categories || [];
  const deadZones = data.dead_zones || [];
  const wantWeak = /\b(weak|weakest|worst|dead|problem)\b/.test(q);
  const wantStrong = /\b(strong|strongest|best|top)\b/.test(q);

  if (wantWeak && deadZones.length > 0) {
    const worst = deadZones.reduce((a, b) => {
      const aR = Number(a.engagement_ratio ?? a.item_opens / (a.opens || 1)) || 100;
      const bR = Number(b.engagement_ratio ?? b.item_opens / (b.opens || 1)) || 100;
      return aR < bR ? a : b;
    });
    const label = catName(worst.category_id || worst.category || worst.id);
    const eng = Number(worst.engagement_ratio) || pct(Number(worst.item_opens || 0), Number(worst.opens || 0));
    if (label) {
      return metaResponse({
        answer: `${label} is the weakest category at ${eng}% item engagement (${worst.item_opens || 0} item views / ${worst.opens} category opens). Guests enter but rarely click items.`,
        confidence: "high",
        intent: "category",
        metric: "dead_zones.engagement_ratio",
        periodHours,
      });
    }
  }

  if (topCategories.length > 0) {
    const pick = wantWeak && !wantStrong ? topCategories[topCategories.length - 1] : topCategories[0];
    const label = catName(pick.id) || "Unmapped Category";
    const role = wantWeak && !wantStrong ? "weakest" : "strongest";
    return metaResponse({
      answer: `${label} is the ${role} category with ${pick.opens} category opens in this period.`,
      confidence: "high",
      intent: "category",
      metric: "top_categories",
      periodHours,
    });
  }

  return metaResponse({
    answer: "Not enough category open data yet to rank categories.",
    confidence: "low",
    intent: "category",
    metric: "top_categories",
    periodHours,
  });
}

function answerItem(data, q, periodHours, foodics) {
  const topItems = data.top_items || [];
  const wantPromote = /\b(promote|push|highlight)\b/.test(q);

  if (foodics?.hasImports && foodics.conversionRows?.length) {
    const rows = foodics.conversionRows;
    if (/\b(high click|low order|high attention|clicks.*order|attention.*low sales)\b/.test(q)) {
      const hit = rows.find((r) => (r.item_impressions ?? r.item_views) >= 10 && (r.impression_conversion_pct ?? r.menu_conversion_pct ?? r.conversion_rate) < 5 && !r.offline_driven) || rows[0];
      return metaResponse({
        answer: `${prefixSignal(hit.signal_strength, hit.item_name)}: high guest attention (${hit.item_impressions ?? hit.item_views} impressions) with ${hit.quantity_sold} orders. ${convLabel(hit)}. ${hit.suggestion}`,
        confidence: hit.signal_strength === "Strong signal" ? "high" : "medium",
        intent: "foodics",
        metric: "impressions vs quantity_sold",
        periodHours,
      });
    }
    if (/\b(low click|high order|selling well|low visibility)\b/.test(q)) {
      const hit = rows.find((r) => (r.item_impressions ?? r.item_views) < 10 && r.quantity_sold >= 5)
        || [...rows].sort((a, b) => b.quantity_sold - a.quantity_sold)[0];
      return metaResponse({
        answer: `${hit.item_name} sells well in Foodics (${hit.quantity_sold} orders) with limited visibility (${hit.item_impressions ?? hit.item_views} impressions). ${hit.suggestion}`,
        confidence: "high",
        intent: "foodics",
        metric: "quantity_sold vs impressions",
        periodHours,
      });
    }
    if (/\b(best conversion|convert|visibility vs)\b/.test(q)) {
      const hit = [...rows].filter((r) => (r.item_impressions ?? r.item_views) >= 5 && !r.offline_driven).sort((a, b) => (b.impression_conversion_pct ?? b.menu_conversion_pct ?? 0) - (a.impression_conversion_pct ?? a.menu_conversion_pct ?? 0))[0];
      if (hit) {
        return metaResponse({
          answer: `${hit.item_name} leads visibility-to-sales: ${convLabel(hit)} (${hit.quantity_sold} orders). Net sales ${hit.net_sales?.toFixed?.(0) ?? hit.net_sales} SAR. Behavior: ${hit.behavior_type || "—"}.`,
          confidence: "high",
          intent: "foodics",
          metric: "impression_conversion_pct",
          periodHours,
        });
      }
    }
    if (wantPromote) {
      const hit = rows.find((r) => r.behavior_type === BEHAVIOR.MENU_TRAP || r.behavior_type === BEHAVIOR.HIDDEN_OPPORTUNITY)
        || rows.sort((a, b) => (b.item_impressions ?? b.item_views) - (a.item_impressions ?? a.item_views))[0];
      return metaResponse({
        answer: `Promote "${hit.item_name}" this week: ${hit.item_impressions ?? hit.item_views} impressions. ${convLabel(hit)}. ${hit.suggestion}`,
        confidence: "high",
        intent: "foodics",
        metric: "conversion + item_views",
        periodHours,
      });
    }
  }

  if (topItems.length > 0) {
    const top = topItems[0];
    return metaResponse({
      answer: wantPromote
        ? `Promote "${top.name}" — ${top.impressions ?? top.opens} impressions in this period. Pair with a visible add-on upsell.`
        : `"${top.name}" leads guest attention with ${top.impressions ?? top.opens} impressions (${top.opens} deep opens).`,
      confidence: "high",
      intent: "item",
      metric: "top_items (item_open)",
      periodHours,
    });
  }

  return metaResponse({
    answer: "Not enough item view data yet.",
    confidence: "low",
    intent: "item",
    metric: "top_items",
    periodHours,
  });
}

function answerAddon(data, periodHours) {
  const byType = data.by_event_type || {};
  const itemOpens = Number(byType.item_open) || 0;
  const addOnClicks = Number(byType.add_on_click) || 0;
  const addOnRate = itemOpens > 0 ? ((addOnClicks / itemOpens) * 100).toFixed(1) : "0";
  const topAddonPairs = data.top_addon_pairs || [];

  if (topAddonPairs.length > 0) {
    const best = topAddonPairs[0];
    return metaResponse({
      answer: `Best add-on pairing: "${best.addon}" on "${best.item}" (${best.clicks || best.count || 0} clicks). Overall add-on conversion is ${addOnRate}% (${addOnClicks} / ${itemOpens} item views).`,
      confidence: "high",
      intent: "addon",
      metric: "add_on_click / item_open",
      periodHours,
    });
  }

  return metaResponse({
    answer: `Add-on conversion is ${addOnRate}% (${addOnClicks} clicks / ${itemOpens} item views). ${Number(addOnRate) < 12 ? "This is low — add preview images and place upsells higher." : "Healthy — test new premium add-ons."}`,
    confidence: itemOpens > 20 ? "medium" : "low",
    intent: "addon",
    metric: "add_on_click / item_open",
    periodHours,
  });
}

function answerVisibilityBehavior(foodics, q, data, periodHours) {
  const rows = foodics?.conversionRows || [];
  const topItems = normalizeTopItems(data?.top_items || []);

  const pick = (filter, sortFn) => {
    const list = rows.filter(filter);
    if (!list.length) return null;
    return [...list].sort(sortFn)[0];
  };

  if (/\b(sell visually|visual seller|photo.*work|card.*sell|which item photo)\b/.test(q)) {
    const hit =
      pick(
        (r) => r.behavior_type === BEHAVIOR.VISUAL_SELLER || (r.visual_efficiency_score ?? 0) >= 60,
        (a, b) => (b.visual_efficiency_score ?? 0) - (a.visual_efficiency_score ?? 0),
      ) ||
      topItems.filter((t) => t.impressions >= 20 && t.opens / Math.max(t.impressions, 1) < 0.12).sort((a, b) => b.impressions - a.impressions)[0];
    if (hit) {
      const name = hit.item_name || hit.name;
      const ve = hit.visual_efficiency_score;
      const note = buildExportCommentary(hit) || hit.visual_efficiency_note || "The card builds confidence — guests order with little need for extra detail.";
      return metaResponse({
        answer: `${prefixSignal(hit.signal_strength, name)}: ${note}${ve != null ? ` Visual Efficiency ${ve}/100.` : ""}`,
        confidence: hit.order_confidence === "High confidence" ? "high" : "medium",
        intent: "visibility",
        metric: "visual_efficiency_score",
        periodHours,
      });
    }
  }

  if (/\b(need more explanation|more detail|guests investigate|deep interest)\b/.test(q)) {
    const hit = pick(
      (r) => r.behavior_type === BEHAVIOR.DISCOVERY_SELLER || ((r.item_modal_opens ?? 0) >= 10 && (r.deep_interest_rate ?? 0) >= 12),
      (a, b) => (b.item_modal_opens ?? 0) - (a.item_modal_opens ?? 0),
    );
    if (hit) {
      return metaResponse({
        answer: `${hit.item_name} attracts deep interest (${hit.item_modal_opens ?? 0} opens / ${hit.item_impressions ?? hit.item_views} impressions) — guests investigate before ordering. ${hit.suggestion}`,
        confidence: "medium",
        intent: "visibility",
        metric: "deep_interest_rate",
        periodHours,
      });
    }
  }

  if (/\b(waiter.?driven|staff recommend|habitual|habit order)\b/.test(q)) {
    const hit = pick(
      (r) => [BEHAVIOR.WAITER_DRIVEN, BEHAVIOR.HABIT_ORDER].includes(r.behavior_type),
      (a, b) => b.quantity_sold - a.quantity_sold,
    );
    if (hit) {
      return metaResponse({
        answer: `${hit.item_name} is ${hit.behavior_type}: ${hit.quantity_sold} orders with limited menu discovery (${hit.item_impressions ?? hit.item_views} impressions). Strong POS sales with low passive exposure often reflect staff recommendation or repeat guest habits — not a menu failure.`,
        confidence: hit.order_confidence === "High confidence" ? "high" : "medium",
        intent: "visibility",
        metric: "behavior_type",
        periodHours,
      });
    }
  }

  if (/\b(attract.*attention|attention.*don.?t sell|menu trap|don.?t sell)\b/.test(q)) {
    const hit = pick(
      (r) => r.behavior_type === BEHAVIOR.MENU_TRAP || ((r.item_impressions ?? r.item_views ?? 0) >= 20 && (r.impression_conversion_pct ?? 100) < 5),
      (a, b) => (b.item_impressions ?? b.item_views) - (a.item_impressions ?? a.item_views),
    );
    if (hit) {
      return metaResponse({
        answer: `${prefixSignal(hit.signal_strength, hit.item_name)}: ${buildExportCommentary(hit) || hit.suggestion}`,
        confidence: "medium",
        intent: "visibility",
        metric: "impression_conversion_pct",
        periodHours,
      });
    }
  }

  if (rows.length) {
    const top = [...rows].sort((a, b) => (b.visual_efficiency_score ?? 0) - (a.visual_efficiency_score ?? 0))[0];
    return metaResponse({
      answer: `Top Visual Efficiency: ${top.item_name} (${top.visual_efficiency_score ?? "—"}/100). ${top.visual_efficiency_note || top.suggestion}`,
      confidence: "medium",
      intent: "visibility",
      metric: "visual_efficiency_score",
      periodHours,
    });
  }

  return metaResponse({
    answer: "Import Foodics sales and collect more impressions to rank visual sellers, discovery items, and menu traps.",
    confidence: "low",
    intent: "visibility",
    metric: null,
    periodHours,
  });
}

function answerSearch(data, periodHours) {
  const lostSearches = data.lost_searches || [];
  const topSearches = data.top_searches || [];

  if (lostSearches.length > 0) {
    const terms = lostSearches
      .slice(0, 3)
      .map((s) => `"${s.query || s.term || s.q}" (${s.sessions || s.count || 0}×)`)
      .filter(Boolean)
      .join(", ");
    return metaResponse({
      answer: `Search friction detected — guests searched for ${terms} without strong results. Add Arabic/English synonyms in Menu Manager rather than duplicating items.`,
      confidence: "high",
      intent: "search",
      metric: "lost_searches",
      periodHours,
    });
  }

  if (topSearches.length > 0) {
    const top = topSearches[0];
    return metaResponse({
      answer: `Top search: "${top.query}" (${top.count}×). No lost searches detected — menu naming matches demand.`,
      confidence: "medium",
      intent: "search",
      metric: "top_searches",
      periodHours,
    });
  }

  return metaResponse({
    answer: "No search data in this period yet.",
    confidence: "low",
    intent: "search",
    metric: "search_used",
    periodHours,
  });
}

function answerLanguage(data, periodHours) {
  const byLang = data.by_language || {};
  const langBehavior = data.lang_behavior || {};
  const enCount = Number(byLang.en) || 0;
  const arCount = Number(byLang.ar) || 0;
  const total = enCount + arCount;
  if (total <= 0) {
    return metaResponse({
      answer: "Not enough language data in this period.",
      confidence: "low",
      intent: "language",
      metric: "by_language",
      periodHours,
    });
  }
  const arPct = pct(arCount, total);
  const dominant = arPct > 50 ? "Arabic" : "English";
  const enAvg = Number(langBehavior.en?.avg_events) || 0;
  const arAvg = Number(langBehavior.ar?.avg_events) || 0;
  const moreEngaged = arAvg > enAvg ? "Arabic" : "English";
  return metaResponse({
    answer: `${dominant} dominates at ${Math.max(arPct, 100 - arPct)}% of tracked events (${arCount} Arabic / ${enCount} English). ${moreEngaged} users explore more items per session — keep ${dominant} UX as priority.`,
    confidence: total > 30 ? "high" : "medium",
    intent: "language",
    metric: "by_language + lang_behavior",
    periodHours,
  });
}

function answerSession(data, periodHours) {
  const totalSessions = Number(data.total_sessions) || 0;
  const bounceSessions = Number(data.bounce_sessions) || 0;
  const bounceRate = totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0;
  const avgTime = Number(data.avg_time_spent) || 0;
  const sq = data.session_quality || {};
  const deep = Number(sq.deep) || 0;
  const power = Number(sq.power) || 0;
  const engagedPct = totalSessions > 0 ? pct(deep + power, totalSessions) : 0;

  return metaResponse({
    answer: `Bounce rate is ${bounceRate}% (${bounceSessions} / ${totalSessions} sessions). Average time on menu is ${formatDuration(avgTime)}. ${engagedPct}% of sessions are deep/power engaged.`,
    confidence: totalSessions > 20 ? "high" : "medium",
    intent: "session",
    metric: "bounce_sessions + avg_time_spent + session_quality",
    periodHours,
  });
}

function answerManagement(data, periodHours) {
  const summary = buildManagementSummary(data);
  if (!summary) {
    return metaResponse({
      answer: "Not enough data for a management summary.",
      confidence: "low",
      intent: "management",
      metric: "management_summary",
      periodHours,
    });
  }
  const bullets = [];
  if (summary.working.length) bullets.push(`What is working: ${summary.working.join(" ")}`);
  if (summary.weak.length) bullets.push(`Needs attention: ${summary.weak.join(" ")}`);
  if (summary.improve.length) bullets.push(`Do today: ${summary.improve.join(" ")}`);
  if (summary.monitor.length) bullets.push(`Monitor next: ${summary.monitor.join(" ")}`);
  return metaResponse({
    answer: bullets.join(" | ") || "Performance is steady.",
    confidence: "high",
    intent: "management",
    metric: "aggregated KPIs",
    periodHours,
  });
}

function answerFoodics(foodics, q, periodHours) {
  if (!foodics?.hasImports) {
    return metaResponse({
      answer: "No Foodics imports yet. Upload a weekly Sales by Product export in Sales Intelligence to unlock visibility vs sales answers.",
      confidence: "low",
      intent: "foodics",
      metric: "foodics_sales_items",
      periodHours,
    });
  }

  const batch = foodics.latestBatch;
  const periodNote = batch
    ? ` Foodics period: ${batch.period_start} → ${batch.period_end}.`
    : "";

  if (/\b(foodics show|this week sales|sales this week)\b/.test(q)) {
    const totalOrders = (foodics.salesItems || []).reduce((s, r) => s + (Number(r.quantity_sold) || 0), 0);
    const totalNet = (foodics.salesItems || []).reduce((s, r) => s + (Number(r.net_sales) || 0), 0);
    return metaResponse({
      answer: `Latest Foodics import: ${totalOrders} items sold, ${totalNet.toFixed(0)} SAR net sales.${periodNote}`,
      confidence: "high",
      intent: "foodics",
      metric: "foodics_sales_items",
      periodHours,
    });
  }

  const rows = foodics.conversionRows || [];
  if (!rows.length) {
    return metaResponse({
      answer: `Foodics import exists but no matched conversion rows yet. Review unmatched items in Sales Intelligence.${periodNote}`,
      confidence: "medium",
      intent: "foodics",
      metric: "conversion_rows",
      periodHours,
    });
  }

  return answerItem({ top_items: [] }, q, periodHours, foodics);
}

function answerImproveToday(data, periodHours) {
  const best = getBestAction(data);
  if (!best) {
    return metaResponse({
      answer: "Not enough data to recommend a priority action today.",
      confidence: "low",
      intent: "improve_today",
      metric: "getBestAction",
      periodHours,
    });
  }
  return metaResponse({
    answer: `${best.action} ${best.reason}`,
    confidence: "high",
    intent: "improve_today",
    metric: best.source,
    periodHours,
  });
}

const FALLBACK_MSG =
  "I don't have enough matching data for that exact question yet. Try asking about scans, peak time, categories, visibility vs sales, visual sellers, searches, add-ons, forecasts, revenue, or Foodics sales.";

function answerForecast(question, data, foodics, periodHours) {
  const intelligence = buildRestaurantIntelligence(data, foodics);
  const fc = answerForecastQuestion(question, data, intelligence, foodics);
  if (fc?.answer) {
    return metaResponse({
      answer: fc.answer,
      confidence: fc.confidence || "medium",
      intent: "forecast",
      metric: "forecastingEngine",
      periodHours,
    });
  }
  return metaResponse({
    answer: "Not enough trend data for a reliable forecast yet. Import Foodics sales or collect more sessions.",
    confidence: "low",
    intent: "forecast",
    metric: null,
    periodHours,
  });
}

function answerRevenue(data, foodics, periodHours) {
  const intelligence = buildRestaurantIntelligence(data, foodics);
  const top = [...(intelligence?.funnels || [])]
    .filter((f) => f.revenue_per_view > 0)
    .sort((a, b) => b.revenue_per_view - a.revenue_per_view)[0];
  if (top) {
    return metaResponse({
      answer: `Best revenue efficiency: "${top.item_name}" at ${top.revenue_per_view} SAR per impression (${top.orders} orders from ${top.item_impressions ?? top.item_opens} visibility events). Visual Efficiency ${top.visual_efficiency_score ?? "—"}/100.`,
      confidence: "high",
      intent: "revenue",
      metric: "revenue_per_view",
      periodHours,
    });
  }
  if (foodics?.hasImports) {
    return metaResponse({
      answer: "Foodics is linked — map more menu items to unlock revenue-per-view rankings.",
      confidence: "medium",
      intent: "revenue",
      metric: "foodics",
      periodHours,
    });
  }
  return metaResponse({
    answer: "Import Foodics sales data to compare impressions and deep interest with actual revenue.",
    confidence: "low",
    intent: "revenue",
    metric: null,
    periodHours,
  });
}

function answerComparison(data, foodics, periodHours) {
  const intelligence = buildRestaurantIntelligence(data, foodics);
  const withTrend = [...(intelligence?.funnels || [])].filter((f) => f.order_trend_pct != null);
  const up = withTrend.find((f) => f.order_trend_pct > 0);
  const down = withTrend.find((f) => f.order_trend_pct < 0);
  if (up || down) {
    const parts = [];
    if (up) parts.push(`"${up.item_name}" orders up ${up.order_trend_pct}% vs prior Foodics batch`);
    if (down) parts.push(`"${down.item_name}" orders down ${Math.abs(down.order_trend_pct)}%`);
    return metaResponse({
      answer: `${parts.join(". ")}.`,
      confidence: "medium",
      intent: "comparison",
      metric: "order_trend_pct",
      periodHours,
    });
  }
  return metaResponse({
    answer: "Switch the time filter (Today / 7D / 30D) to compare menu periods. Foodics trends need two import batches.",
    confidence: "low",
    intent: "comparison",
    metric: null,
    periodHours,
  });
}

export function answerQuestion(question, data, options = {}) {
  const periodHours = Number(options.periodHours) || 0;
  const foodics = options.foodics || null;

  if (!question?.trim()) {
    return metaResponse({ answer: FALLBACK_MSG, confidence: "low", intent: "fallback", metric: null, periodHours });
  }

  if (!data || typeof data !== "object") {
    return metaResponse({
      answer: "Not enough analytics data yet. Collect more sessions before making a confident decision.",
      confidence: "low",
      intent: "fallback",
      metric: null,
      periodHours,
    });
  }

  const totalSessions = Number(data.total_sessions) || 0;
  const { intent, intent_debug } = detectIntent(question);

  const route = (fn) => enrichResponse(fn(), data, foodics, intent_debug);

  if (intent === "time_peak") return route(() => answerTimePeak(data, periodHours));
  if (intent === "visibility") return route(() => answerVisibilityBehavior(foodics, question.toLowerCase(), data, periodHours));
  if (intent === "foodics") return route(() => answerFoodics(foodics, question.toLowerCase(), periodHours));
  if (intent === "management") return route(() => answerManagement(data, periodHours));
  if (intent === "search") return route(() => answerSearch(data, periodHours));
  if (intent === "language") return route(() => answerLanguage(data, periodHours));
  if (intent === "addon") return route(() => answerAddon(data, periodHours));
  if (intent === "session") return route(() => answerSession(data, periodHours));
  if (intent === "category") return route(() => answerCategory(data, question.toLowerCase(), periodHours));
  if (intent === "item") return route(() => answerItem(data, question.toLowerCase(), periodHours, foodics));
  if (intent === "improve_today") return route(() => answerImproveToday(data, periodHours));
  if (intent === "forecast") return route(() => answerForecast(question, data, foodics, periodHours));
  if (intent === "revenue") return route(() => answerRevenue(data, foodics, periodHours));
  if (intent === "comparison") return route(() => answerComparison(data, foodics, periodHours));

  if (intent === "fallback") {
    if (totalSessions < 5) {
      return route(() => metaResponse({
        answer: "Not enough session data yet. Collect more guest sessions first.",
        confidence: "low",
        intent: "fallback",
        metric: "total_sessions",
        periodHours,
      }));
    }
    return route(() => metaResponse({
      answer: FALLBACK_MSG,
      confidence: "low",
      intent: "fallback",
      metric: null,
      periodHours,
    }));
  }

  return route(() => metaResponse({ answer: FALLBACK_MSG, confidence: "low", intent: "fallback", metric: null, periodHours }));
}
