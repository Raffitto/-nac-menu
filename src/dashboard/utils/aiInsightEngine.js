import { formatDuration } from "./formatters";

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
        action: `Add "${query}" to the menu, or create an alias so existing items appear for this search.`,
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
    const q = lostSearches[0].query || lostSearches[0].term || lostSearches[0].q;
    if (q) improve.push(`Add "${q}" to the menu or fix naming — guests searched for it.`);
  }
  if (Number(addOnRate) < 10) improve.push("Improve add-on visibility with preview images and better positioning.");
  if (bounceRate > 30) improve.push("Improve landing experience — faster load, better hero category.");

  monitor.push("Search queries for new demand signals.");
  monitor.push("Add-on conversion trend week over week.");
  if (deadZones.length > 0) monitor.push("Dead zone categories after any menu changes.");

  return { working, weak, improve, monitor, qrStarts, totalSessions, totalEvents, avgTime, addOnRate, bounceRate, returningRate };
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
        action: `Add "${q}" to the menu or create a search alias. Guests searched for it ${count} times.`,
        reason: "Unmet demand is the fastest revenue opportunity.",
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

export function answerQuestion(question, data) {
  if (!data || !question) return { answer: "Not enough data yet. Collect more sessions before making a confident decision.", confidence: "low" };

  const q = question.toLowerCase().trim();
  const byType = data.by_event_type || {};
  const totalSessions = Number(data.total_sessions) || 0;
  const itemOpens = Number(byType.item_open) || 0;
  const addOnClicks = Number(byType.add_on_click) || 0;
  const topCategories = data.top_categories || [];
  const topItems = data.top_items || [];
  const topAddonPairs = data.top_addon_pairs || [];
  const lostSearches = data.lost_searches || [];
  const deadZones = data.dead_zones || [];
  const bounceSessions = Number(data.bounce_sessions) || 0;
  const langBehavior = data.lang_behavior || {};
  const byLang = data.by_language || {};
  const addOnRate = itemOpens > 0 ? ((addOnClicks / itemOpens) * 100).toFixed(1) : "0";
  const bounceRate = totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0;

  if (totalSessions < 5) {
    return { answer: "Not enough data yet. Collect more sessions before making a confident decision.", confidence: "low" };
  }

  if (q.includes("improve") || q.includes("today") || q.includes("should i do")) {
    const best = getBestAction(data);
    if (best) return { answer: best.action + " " + best.reason, confidence: "high" };
  }

  if (q.includes("promote") || q.includes("push") || q.includes("highlight")) {
    if (topItems.length > 0) {
      const top = topItems[0];
      return { answer: `Promote "${top.name}" — it has ${top.opens} views and strong interest. Pair it with an add-on upsell to maximize revenue.`, confidence: "high" };
    }
    return { answer: "Not enough item data to recommend a promotion target.", confidence: "low" };
  }

  if (q.includes("search") || q.includes("not offer") || q.includes("missing") || q.includes("looking for")) {
    if (lostSearches.length > 0) {
      const terms = lostSearches.slice(0, 3).map((s) => `"${s.query || s.term || s.q}"`).filter(Boolean).join(", ");
      return { answer: `Yes. Guests searched for ${terms} but found nothing. Consider adding these items or fixing naming.`, confidence: "high" };
    }
    return { answer: "No unmet searches detected. Your menu naming matches guest expectations well.", confidence: "medium" };
  }

  if (q.includes("weak") || q.includes("worst") || q.includes("dead") || q.includes("problem")) {
    if (deadZones.length > 0) {
      const worst = deadZones[0];
      const label = catName(worst.category || worst.id) || "a category";
      const engPct = Number(worst.opens) > 0 ? pct(Number(worst.item_views || 0), Number(worst.opens)) : 0;
      return { answer: `${label} is the weakest at ${engPct}% engagement. Guests open it but don't click items. Needs better visuals and a hero item.`, confidence: "high" };
    }
    if (topCategories.length > 1) {
      const last = topCategories[topCategories.length - 1];
      const label = catName(last.id) || "the least popular category";
      return { answer: `${label} has the fewest opens at ${last.opens}. Consider promoting it or improving its position.`, confidence: "medium" };
    }
  }

  if (q.includes("add-on") || q.includes("addon") || q.includes("upsell")) {
    if (topAddonPairs.length > 0) {
      const best = topAddonPairs[0];
      return { answer: `Best add-on: "${best.addon}" on "${best.item}". Overall rate is ${addOnRate}%. ${Number(addOnRate) < 12 ? "This is low — improve add-on visibility with images." : "Healthy — maintain and test new pairings."}`, confidence: "high" };
    }
    return { answer: `Add-on conversion is ${addOnRate}%. ${Number(addOnRate) < 12 ? "Below average. Add preview images and better positioning." : "Performing well. Consider adding premium options."}`, confidence: "medium" };
  }

  if (q.includes("arabic") || q.includes("english") || q.includes("language") || q.includes("lang")) {
    const enCount = Number(byLang.en) || 0;
    const arCount = Number(byLang.ar) || 0;
    const total = enCount + arCount;
    if (total > 0) {
      const arPct = pct(arCount, total);
      const dominant = arPct > 50 ? "Arabic" : "English";
      const enAvg = Number(langBehavior.en?.avg_events) || 0;
      const arAvg = Number(langBehavior.ar?.avg_events) || 0;
      const moreEngaged = arAvg > enAvg ? "Arabic" : "English";
      return { answer: `${dominant} is used by ${Math.max(arPct, 100 - arPct)}% of guests. ${moreEngaged} users explore more items per session. Prioritize ${dominant} content quality but maintain both.`, confidence: "high" };
    }
  }

  if (q.includes("biggest") || q.includes("issue") || q.includes("critical") || q.includes("urgent")) {
    if (bounceRate > 40) return { answer: `Bounce rate at ${bounceRate}% is critical. You're losing nearly half your guests before they browse. Fix loading speed and first-screen appeal.`, confidence: "high" };
    if (Number(addOnRate) < 8) return { answer: `Add-on conversion at ${addOnRate}% is the biggest revenue gap. Guests view items but don't click add-ons. Add images and better prompts.`, confidence: "high" };
    if (deadZones.length > 0) {
      const worst = deadZones[0];
      const label = catName(worst.category || worst.id) || "A category";
      return { answer: `${label} is a dead zone — guests open it but nothing catches their eye. Needs a complete visual refresh.`, confidence: "high" };
    }
    return { answer: "No critical issues detected. Focus on gradual improvement of add-on conversion and engagement depth.", confidence: "medium" };
  }

  if (q.includes("management") || q.includes("summary") || q.includes("meeting") || q.includes("report")) {
    const summary = buildManagementSummary(data);
    if (summary) {
      const parts = [];
      if (summary.working.length > 0) parts.push("Working well: " + summary.working[0]);
      if (summary.weak.length > 0) parts.push("Needs attention: " + summary.weak[0]);
      if (summary.improve.length > 0) parts.push("Action item: " + summary.improve[0]);
      return { answer: parts.join(" ") || "Performance is steady. No urgent concerns.", confidence: "high" };
    }
  }

  if (q.includes("strong") || q.includes("best") || q.includes("top") || q.includes("popular")) {
    if (topCategories.length > 0) {
      const top = topCategories[0];
      const label = catName(top.id) || "Top category";
      return { answer: `${label} is your strongest category with ${top.opens} opens. ${topItems.length > 0 ? `Top item: "${topItems[0].name}".` : ""}`, confidence: "high" };
    }
  }

  const best = getBestAction(data);
  if (best) return { answer: `Based on current data: ${best.action}`, confidence: "medium" };

  return { answer: "I don't have enough specific data to answer that precisely. Try asking about categories, add-ons, searches, language, or engagement.", confidence: "low" };
}
