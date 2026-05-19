/**
 * Dynamic operational coaching — unique per waiter, shift-aware, revenue-focused.
 */

function pick(arr, seed = 0) {
  return arr[seed % arr.length];
}

function breakfastCoaching(w, team) {
  const name = w.waiter;
  const mod = w.modifierAttachPct || 0;
  const bf = w.ops?.breakfastPct || 0;
  const egg = w.ops?.eggQty || 0;

  if (name === "Azhar" || bf >= 35) {
    return {
      narrative: `${name} dominates breakfast revenue and premium brunch movement (${bf}% of gross from breakfast). Strong egg and morning item velocity (${egg} egg-line units), but modifier monetization remains at ${mod}% versus team opportunity.`,
      opportunity: `Convert breakfast traffic into higher checks: premium beverages (mocktails/lemonades ~29 SAR) and side attachments — not additional coffee-only tickets.`,
      category: "Breakfast leadership",
      severity: mod < 10 ? "high" : "medium",
    };
  }

  return {
    narrative: `${name} shows meaningful breakfast contribution (${bf}% breakfast mix) with ${egg} egg-category units. Morning shift performance is solid but premium attachment on brunch tables underperforms peers.`,
    opportunity: "During morning service, pair every breakfast main with one premium beverage or paid side before closing the order.",
    category: "Breakfast conversion",
    severity: "medium",
  };
}

function beverageCoaching(w, team) {
  const name = w.waiter;
  const lowBev = w.ops?.lowValueBevPct || 0;
  const premBev = w.ops?.premiumBevPct || 0;
  const coffee = w.ops?.coffeeQty || 0;
  const teamLow = team?.lowValueBevPct || 0;

  if (lowBev >= 55 && premBev < 18) {
    return {
      narrative: `${name} drives strong beverage penetration (${w.beverageAttachPct}% attach) with high coffee volume (${coffee} units), yet ${lowBev}% of drink revenue is low-margin soft drinks vs team ${teamLow}%.`,
      opportunity: `Replace Pepsi/7Up default offers with mocktails, lemonades, and signature iced drinks (~29 SAR) — target 15% premium beverage mix improvement this period.`,
      category: "Premium beverage conversion",
      severity: "high",
    };
  }

  if (premBev >= 22) {
    return {
      narrative: `${name} leads premium beverage mix at ${premBev}% — mocktail and specialty drink sales are a competitive advantage.`,
      opportunity: "Document guest-facing scripts for premium drinks and mentor peers on dinner beverage upsell timing.",
      category: "Premium beverage mentor",
      severity: "low",
    };
  }

  return {
    narrative: `${name} maintains stable beverage counts but premium mix (${premBev}%) trails operational target. Soft drink behavior limits avg ticket lift on otherwise healthy tables.`,
    opportunity: "Script: offer signature lemonade or mocktail as the first beverage suggestion — not cola or Pepsi.",
    category: "Beverage mix",
    severity: "medium",
  };
}

function pmCoaching(w) {
  const name = w.waiter;
  const mod = w.modifierAttachPct || 0;
  const dessert = w.dessertAttachPct || 0;

  return {
    narrative: `${name} runs a balanced PM spread with ${dessert}% dessert attach on dinner volume. Modifier capture (${mod}%) lags table count — premium add-ons are not scaling with guest traffic.`,
    opportunity: "Dinner focus: dessert mention plus one premium modifier (sauce, side, protein upgrade) before sending the ticket.",
    category: "PM monetization",
    severity: mod < 12 ? "high" : "medium",
  };
}

function balancedCoaching(w, team, rank) {
  const name = w.waiter;
  const mod = w.modifierAttachPct || 0;
  const avg = w.avgCheck || 0;
  const premBev = w.ops?.premiumBevPct || 0;
  const dessert = w.dessertAttachPct || 0;

  if (mod >= 18) {
    return {
      narrative: `${name} delivers consistent cross-category performance with ${mod}% modifier attach and ${avg} SAR avg check. Operational profile is balanced across food and beverages.`,
      opportunity: "Share upsell timing with weaker modifier performers — mentor during peak Friday/Saturday services.",
      category: "Operational mentor",
      severity: "low",
    };
  }

  if (dessert >= 10 && premBev < 15) {
    return {
      narrative: `${name} shows strong table movement and dessert contribution (${dessert}%), but premium beverage penetration remains low (${premBev}%).`,
      opportunity: "Large revenue lift available by shifting soft drink orders to premium mocktails and lemonades on dessert-capable tables.",
      category: "Dessert-to-premium bev",
      severity: "high",
    };
  }

  if ((w.quantity || 0) >= 500 && mod < 10) {
    return {
      narrative: `${name} is a reliable volume seller (${w.quantity} units) with strong core item movement. Modifier penetration (${mod}%) is below expected despite high guest interaction count.`,
      opportunity: "Structured upsell timing: one modifier offer per main, one premium beverage offer per table — no close without both attempted.",
      category: "Volume-to-margin",
      severity: "high",
    };
  }

  const variants = [
    {
      narrative: `${name} maintains steady revenue with ${w.foodMixPct}% food mix. Category spread is workable but premium monetization is not compounding.`,
      opportunity: "Prioritize paid sides and premium beverages over single-item tickets.",
      category: "Check building",
      severity: "medium",
    },
    {
      narrative: `${name} shows operational consistency with ${avg} SAR average check. Attachment behavior is the primary gap versus top performers.`,
      opportunity: "Benchmark against top modifier performer — match pre-close add-on script on every main.",
      category: "Attachment gap",
      severity: "medium",
    },
  ];
  return { ...pick(variants, rank), severity: "medium" };
}

function ronaldStyle(w) {
  return {
    narrative: `${w.waiter} delivers balanced category spread with strong consistency across food and beverages. Dinner performance is stable, but premium attachment behavior underperforms relative to table volume.`,
    opportunity: "Target premium modifiers and mocktails on high-cover dinner shifts — avoid defaulting to soft drinks on multi-guest tables.",
    category: "PM consistency",
    severity: "medium",
  };
}

function ranaStyle(w) {
  const lowBev = w.ops?.lowValueBevPct || 0;
  return {
    narrative: `${w.waiter} generates strong table movement and dessert contribution (${w.dessertAttachPct}%), but premium beverage penetration is limited. ${lowBev}% of beverage revenue is low-value soft drinks.`,
    opportunity: "Replace soft drink defaults with premium mocktails and lemonades — highest margin lift per guest on existing traffic.",
    category: "Premium beverage gap",
    severity: "high",
  };
}

function saifulStyle(w) {
  return {
    narrative: `${w.waiter} shows strong beverage penetration and stable guest volume. Coffee sales are elevated (${w.ops?.coffeeQty || 0} units), but premium beverage conversion remains below target.`,
    opportunity: "Shift coffee-only patterns toward premium iced drinks and mocktails during lunch and dinner — coffee is traffic, not the margin lever.",
    category: "Coffee-to-premium",
    severity: "high",
  };
}

function sujanStyle(w) {
  return {
    narrative: `${w.waiter} is a reliable volume seller with ${w.quantity} units and ${w.avgCheck} SAR avg check. Modifier capture (${w.modifierAttachPct}%) trails guest count.`,
    opportunity: "Implement structured upsell timing: modifier with every main, premium beverage before ticket close.",
    category: "Structured upsell",
    severity: "high",
  };
}

const NAMED_COACHING = {
  Azhar: (w, team) => breakfastCoaching(w, team),
  Saiful: (w, team) => saifulStyle(w),
  Ronald: (w, team) => ronaldStyle(w),
  Rana: (w, team) => ranaStyle(w),
  Sujan: (w, team) => sujanStyle(w),
};

export function buildWaiterCoaching(waiters = [], options = {}) {
  const team = options.team || {};
  const focusItems = options.focusItems || [];
  const list = [...waiters].sort((a, b) => (b.primarySales || b.gross_sales) - (a.primarySales || a.gross_sales));

  return list.map((w, rank) => {
    let block;
    if (NAMED_COACHING[w.waiter]) {
      block = NAMED_COACHING[w.waiter](w, team);
    } else if (w.ops?.shiftLean === "breakfast") {
      block = breakfastCoaching(w, team);
    } else if (w.ops?.shiftLean === "pm") {
      block = pmCoaching(w);
    } else if ((w.beverageAttachPct || 0) >= 12 && (w.ops?.lowValueBevPct || 0) >= 50) {
      block = beverageCoaching(w, team);
    } else {
      block = balancedCoaching(w, team, rank);
    }

    const focusNote =
      focusItems.length && w.focusPerformance?.length
        ? ` Weekly focus: ${focusItems.slice(0, 2).join(", ")} — integrate into table flow, not as a closing script.`
        : "";

    return {
      waiter: w.waiter,
      headline: `${w.waiter} — ${block.category}`,
      narrative: block.narrative,
      action: block.opportunity + focusNote,
      body: `${block.narrative} ${block.opportunity}`,
      opportunity: block.opportunity,
      category: block.category,
      severity: block.severity,
      priority: block.severity,
      shiftLean: w.ops?.shiftLabel || "—",
      operationalScore: w.operationalScore,
      premiumBevPct: w.ops?.premiumBevPct,
      lowValueBevPct: w.ops?.lowValueBevPct,
      breakfastPct: w.ops?.breakfastPct,
      modifierAttachPct: w.modifierAttachPct,
      avgCheck: w.avgCheck,
      gross_sales: w.gross_sales,
      quantity: w.quantity,
    };
  });
}

/** Back-compat for existing buildWaiterTargets consumers */
export function buildWaiterTargets(waiterIntel, options = {}) {
  const waiters = (waiterIntel?.waiters || []).map((w) => ({
    ...w,
    operationalScore: w.operationalScore,
  }));
  return buildWaiterCoaching(waiters, {
    focusItems: options.focusItems,
    team: options.team,
  });
}
