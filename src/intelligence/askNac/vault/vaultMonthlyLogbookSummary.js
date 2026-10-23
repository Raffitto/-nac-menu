/**
 * Deterministic monthly executive summary from recovered daily_logbook structured facts.
 */

import { classifyOperationalIssue } from "./vaultDocumentSearchRanking";

const TEXT_KEYS = [
  "complaints",
  "operational_issues",
  "operational_highlights",
  "breakfast_notes",
  "lunch_notes",
  "dinner_notes",
  "training_notes",
  "staff_performance_notes",
];

export const MONTHLY_LOGBOOK_SUMMARY_METRIC_KEYS = [
  ...TEXT_KEYS,
  "reservations",
  "covers",
  "walkins",
  "no_shows",
  "cancellations",
  "google_review_5",
  "google_review_4",
  "google_review_3",
  "google_review_2",
  "google_review_1",
];

const RECEPTION_KEYS = ["reservations", "covers", "walkins", "no_shows", "cancellations"];
const GOOGLE_KEYS = [
  "google_review_5",
  "google_review_4",
  "google_review_3",
  "google_review_2",
  "google_review_1",
];

const THEME_RULES = [
  { id: "traffic_quiet", label: "Quiet / low demand", re: /\b(quiet|slow|empty mall|mall empty|few reservations|low covers|mostly coffee|coffee and dessert)\b/i },
  { id: "traffic_busy", label: "Busy / strong demand", re: /\b(busy|full house|high covers|strong dinner|packed)\b/i },
  { id: "complaint", label: "Guest complaints", re: /\b(complain(?:ed|ing|s)?|complaint|refused|undercooked|charge|remove from bill|insect in (?:the )?(?:food|drink|plate)|fly in (?:the )?(?:food|drink|plate)|upset)\b/i },
  { id: "maintenance", label: "Maintenance / facilities", re: /\b(drainage|electrician|pest|gel|powder|trap|battery|ccm|router|repair|leak)\b/i },
  { id: "staffing_system", label: "Staffing / systems", re: /\b(jisr|punch|inventory|upselling|training|staff)\b/i },
  { id: "service_win", label: "Service recovery / wins", re: /\b(satisfied|smooth|well|recovered|apologize|new one|resolved)\b/i },
];

function formatDayLabel(day) {
  if (!day?.date) return day?.fileTitle || "Unknown date";
  const [y, m, d] = String(day.date).split("-").map(Number);
  if (!y || !m || !d) return day.fileTitle || day.date;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function snippet(text = "", max = 140) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function collectDayTexts(day) {
  return TEXT_KEYS.map((key) => day.texts[key]).filter(Boolean).join(" ");
}

function groupFactsByDay(facts = []) {
  const byDay = new Map();
  for (const fact of facts) {
    const dayKey = fact.periodStart || fact.fileId || fact.fileTitle;
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, {
        date: fact.periodStart || null,
        fileId: fact.fileId,
        fileTitle: fact.fileTitle,
        texts: {},
        metrics: {},
      });
    }
    const row = byDay.get(dayKey);
    if (TEXT_KEYS.includes(fact.metricKey)) {
      const text = fact.dimensions?.text_value || "";
      if (text) row.texts[fact.metricKey] = row.texts[fact.metricKey] ? `${row.texts[fact.metricKey]} ${text}` : text;
    } else if (fact.metricValue != null && Number.isFinite(Number(fact.metricValue))) {
      row.metrics[fact.metricKey] = (row.metrics[fact.metricKey] || 0) + Number(fact.metricValue);
    }
  }
  return [...byDay.values()].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function aggregateReception(days) {
  const totals = {};
  for (const key of RECEPTION_KEYS) totals[key] = 0;
  let daysWith = 0;
  for (const day of days) {
    let has = false;
    for (const key of RECEPTION_KEYS) {
      if (day.metrics[key] != null) {
        totals[key] += day.metrics[key];
        has = true;
      }
    }
    if (has) daysWith += 1;
  }
  return { totals, daysWith };
}

function aggregateGoogle(days) {
  const totals = {};
  for (const key of GOOGLE_KEYS) totals[key] = 0;
  let daysWith = 0;
  for (const day of days) {
    let has = false;
    for (const key of GOOGLE_KEYS) {
      if (day.metrics[key]) {
        totals[key] += day.metrics[key];
        has = true;
      }
    }
    if (has) daysWith += 1;
  }
  const totalReviews = Object.values(totals).reduce((sum, n) => sum + n, 0);
  return { totals, totalReviews, daysWith };
}

function extractThemes(days) {
  const themes = new Map();
  for (const day of days) {
    const blob = collectDayTexts(day);
    if (!blob) continue;
    for (const rule of THEME_RULES) {
      if (!rule.re.test(blob)) continue;
      if (!themes.has(rule.id)) {
        themes.set(rule.id, { id: rule.id, label: rule.label, count: 0, examples: [] });
      }
      const entry = themes.get(rule.id);
      entry.count += 1;
      if (entry.examples.length < 4) {
        entry.examples.push(`${formatDayLabel(day)}: ${snippet(blob)}`);
      }
    }
  }
  return [...themes.values()].sort((a, b) => b.count - a.count);
}

/**
 * Preserve source sections rather than classifying a concatenated daily blob.
 * Each record remains traceable to its date, source and shift/section.
 */
export function buildOperationalEvidenceLedger(facts = []) {
  const entries = [];
  const seen = new Set();
  for (const fact of facts) {
    if (!TEXT_KEYS.includes(fact.metricKey)) continue;
    const text = String(fact.dimensions?.text_value || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const date = fact.periodStart || null;
    const dedupeKey = `${date}|${fact.metricKey}|${text.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const themes = THEME_RULES.filter((rule) => rule.re.test(text)).map((rule) => rule.id);
    entries.push({
      date, section: fact.metricKey, text,
      themes, issueType: classifyOperationalIssue(text),
      fileId: fact.fileId, fileTitle: fact.fileTitle,
    });
  }
  return entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function compareOperationalEvidenceWindows(ledger, first, second) {
  const within = (entry, period) => entry.date && entry.date >= period.startDate && entry.date <= period.endDate;
  const summarize = (period) => {
    const entries = ledger.filter((entry) => within(entry, period));
    const days = new Set(entries.map((entry) => entry.date));
    const themeDays = {};
    for (const rule of THEME_RULES) {
      themeDays[rule.id] = new Set(entries.filter((entry) => entry.themes.includes(rule.id)).map((entry) => entry.date)).size;
    }
    return { label: period.label, daysCovered: days.size, themeDays, entries };
  };
  const a = summarize(first);
  const b = summarize(second);
  return {
    first: a, second: b,
    changes: THEME_RULES.map((rule) => ({
      id: rule.id, label: rule.label,
      firstDays: a.themeDays[rule.id], secondDays: b.themeDays[rule.id],
      deltaDays: b.themeDays[rule.id] - a.themeDays[rule.id],
    })),
  };
}

function recurringThemes(themes) {
  return themes.filter((theme) => theme.count >= 2);
}

function confidenceFromCoverage(logbookDays, readyDays) {
  if (logbookDays >= 20 || readyDays >= 18) return "high";
  if (logbookDays >= 10 || readyDays >= 8) return "medium";
  if (logbookDays >= 2 || readyDays >= 2) return "low";
  return "none";
}

function confidenceLevelToEnum(level) {
  if (level === "high") return "high";
  if (level === "medium") return "medium";
  if (level === "low") return "low";
  return "none";
}

function buildSection(title, lines) {
  const body = lines.filter(Boolean);
  if (!body.length) return null;
  return `**${title}**\n${body.map((line) => `- ${line}`).join("\n")}`;
}

const SECTION_LABELS = {
  breakfast_notes: "Breakfast",
  lunch_notes: "Lunch",
  dinner_notes: "Dinner",
  complaints: "Complaints",
  operational_issues: "Operational issues",
  operational_highlights: "Highlights",
  training_notes: "Training",
  staff_performance_notes: "Staff performance",
};

const FOCUS_LABELS = {
  complaints: "guest complaints",
  maintenance: "maintenance incidents",
  staff: "staff performance notes",
  food_quality: "food-quality issues",
  beverage: "beverage-quality issues",
  service: "service problems",
};

function narrativeText(fact) {
  const dims = fact?.dimensions || {};
  return String(dims.text_value || "").replace(/\s+/g, " ").trim();
}

function withoutNegatedAbsences(text) {
  return String(text || "").replace(/\bno\s+(?:major\s+)?(?:issues?|problems?|complaints?|86)\b/gi, " ");
}

function matchesFocus(mode, text, fact) {
  const cleaned = withoutNegatedAbsences(text);
  if (mode === "complaints") {
    return /\b(complain(?:ed|ing|t|ts)?|guest (?:was |were )?(?:unhappy|upset|disappointed)|dissatisfied|not satisfied|removed from (?:the )?bill|refund(?:ed)?|comped)\b/i.test(cleaned)
      || /\b(undercooked|overcooked|cold food|cold eggs|hair in|insect in|fly in|wrong order|long wait|slow service|rude (?:staff|server)|service was slow)\b/i.test(cleaned);
  }
  if (mode === "maintenance") {
    return /\b(maintenance|repair(?:ed|ing)?|leak(?:ing|ed)?|electrician|drainage|pest control|broken|hvac|equipment (?:down|failed|stopped)|ac (?:down|stopped|not working))\b/i.test(text);
  }
  if (mode === "staff") {
    return fact?.metricKey === "staff_performance_notes"
      || /\b(staff performance|understaffed|short[- ]staffed|sick leave|late arrival|server was late|training (?:gap|missed))\b/i.test(text);
  }
  if (mode === "food_quality") {
    return /\b(food quality|undercooked|overcooked|cold (?:food|eggs|fries|pasta)|raw|burnt|bland|hair in|insect)\b/i.test(cleaned)
      || (/\bfood\b/i.test(cleaned) && /\b(complain|late|wrong|bad|cold|quality)\b/i.test(cleaned));
  }
  if (mode === "beverage") {
    return /\b(beverage|drink|coffee|cocktail|juice|tea|mocktail)\b/i.test(text)
      && /\b(wrong|cold|bitter|watered|weak|spilled|complain|bad|off)\b/i.test(cleaned);
  }
  if (mode === "service") {
    return /\b(slow service|service was slow|long wait|kept waiting|rude|ignored|poor service|service (?:issue|problem|complaint|delay))\b/i.test(cleaned);
  }
  return false;
}

function recordedAction(text) {
  const match = String(text || "").match(/\b(?:kitchen |service )?(?:remade|replaced|removed from (?:the )?bill|comped|refunded|apolog(?:ized|ised)|resolved|guest (?:was )?satisfied)[^.]*/i);
  return match ? match[0].trim() : null;
}

function formatIncidentDate(iso) {
  if (!iso) return "Undated";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  const label = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${label} (${iso})`;
}

function narrativeCoverage(facts = []) {
  const breakfast = new Set();
  const lunch = new Set();
  const dinner = new Set();
  const any = new Set();
  for (const fact of facts) {
    if (!TEXT_KEYS.includes(fact.metricKey) || !narrativeText(fact)) continue;
    const date = fact.periodStart || "undated";
    any.add(date);
    if (fact.metricKey === "breakfast_notes") breakfast.add(date);
    if (fact.metricKey === "lunch_notes") lunch.add(date);
    if (fact.metricKey === "dinner_notes") dinner.add(date);
  }
  return { days: any.size, breakfast: breakfast.size, lunch: lunch.size, dinner: dinner.size };
}

export function buildFocusedNarrativeSummary({
  facts = [],
  coverage = [],
  branchLabel = "Branch",
  periodLabel = "Period",
  mode = "complaints",
  compareSummary = null,
}) {
  const label = FOCUS_LABELS[mode] || "operational incidents";
  const readyDays = (coverage || []).filter((row) => row.readinessStatus === "ready").length;
  const coverageCounts = narrativeCoverage(facts);
  const incidents = [];
  const seen = new Set();
  for (const fact of facts) {
    if (!TEXT_KEYS.includes(fact.metricKey)) continue;
    const text = narrativeText(fact);
    if (!text || !matchesFocus(mode, text, fact)) continue;
    const key = `${fact.periodStart}|${fact.metricKey}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    incidents.push({
      date: fact.periodStart || null,
      section: SECTION_LABELS[fact.metricKey] || fact.metricKey,
      text,
      source: fact.fileTitle || fact.fileId || "daily logbook",
      provenance: fact.dimensions?.provenance || null,
      action: recordedAction(text),
    });
  }
  incidents.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  const coverageLine = `${branchLabel}, ${periodLabel}: recovered logbook narratives cover ${coverageCounts.days} day(s)`
    + ` (${coverageCounts.breakfast} breakfast, ${coverageCounts.lunch} lunch, ${coverageCounts.dinner} dinner).`;

  const lines = incidents.slice(0, 24).map((item) => {
    const provenance = item.provenance ? `, ${item.provenance}` : "";
    const action = item.action ? ` Recorded action: ${item.action}.` : "";
    return `${formatIncidentDate(item.date)} · ${item.section} · ${item.text}${action} Source: ${item.source} (ask_nac_structured_facts, ${item.section}${provenance}).`;
  });
  if (incidents.length > 24) {
    lines.push(`${incidents.length - 24} additional matching narrative(s) were retrieved and are not listed here.`);
  }

  const repeated = new Map();
  for (const item of incidents) {
    const key = String(item.text || "").split(/[.!?]/)[0].toLowerCase().replace(/\s+/g, " ").trim();
    if (!repeated.has(key)) repeated.set(key, new Set());
    if (item.date) repeated.get(key).add(item.date);
  }
  const recurring = [...repeated.entries()].filter(([, dates]) => dates.size >= 2);

  let directAnswer;
  if (!incidents.length) {
    directAnswer = [
      coverageLine,
      `No ${label} language was identified in those narratives.`,
      "This is a review of retrieved logbook text. It does not prove that no incident occurred, and it is not a reason to re-upload logbooks.",
    ].join(" ");
  } else {
    directAnswer = [
      coverageLine,
      `${incidents.length} ${label} narrative(s) identified. Actions are quoted only when the logbook states them.`,
      recurring.length
        ? `Recurring wording on 2 or more days: ${recurring.slice(0, 4).map(([text, dates]) => `${dates.size} day(s) — ${snippet(text, 80)}`).join("; ")}.`
        : null,
      lines.map((line) => `- ${line}`).join("\n"),
    ].filter(Boolean).join("\n\n");
  }

  if (compareSummary?.length) {
    directAnswer += `\n\n**Comparison**\n${compareSummary.map((line) => `- ${line}`).join("\n")}`;
  }

  const vaultSources = [...new Map(
    incidents.filter((item) => item.source).map((item) => [item.source, {
      fileId: item.source,
      title: item.source,
      reportType: "daily_logbook",
      periodStart: item.date,
      periodEnd: item.date,
    }]),
  ).values()];

  return {
    title: `${label[0].toUpperCase()}${label.slice(1)} · ${branchLabel} · ${periodLabel}`,
    directAnswer,
    keyMetrics: [
      { label: "Narrative days", value: String(coverageCounts.days) },
      { label: "Matching narratives", value: String(incidents.length) },
      { label: "Breakfast days", value: String(coverageCounts.breakfast) },
      { label: "Lunch days", value: String(coverageCounts.lunch) },
      { label: "Dinner days", value: String(coverageCounts.dinner) },
    ],
    insights: lines.slice(0, 12),
    recommendations: [
      `Evidence table: ask_nac_structured_facts for ${periodLabel}.`,
      readyDays ? `${readyDays} ready coverage row(s) in this window.` : null,
    ].filter(Boolean),
    confidence: incidents.length >= 3 ? "medium" : incidents.length ? "low" : "none",
    logbookDays: coverageCounts.days,
    readyDays,
    groupedFindings: incidents.map((item) => ({
      date: item.date,
      issueType: mode,
      severity: "medium",
      excerpt: snippet(item.text, 180),
      source: item.source,
      fileTitle: item.source,
      section: item.section,
    })),
    vaultSources,
  };
}

export function buildMonthlyLogbookExecutiveSummary({
  facts = [],
  coverage = [],
  branchLabel = "Branch",
  periodLabel = "Period",
  mode = "summary",
  compareSummary = null,
}) {
  const days = groupFactsByDay(facts);
  const readyDays = (coverage || []).filter((row) => row.readinessStatus === "ready").length;
  const logbookDays = days.length;
  const confidence = confidenceFromCoverage(logbookDays, readyDays);

  if (!logbookDays) {
    return {
      title: `Operational summary · ${periodLabel}`,
      directAnswer: `No recovered daily logbook narratives were returned for ${branchLabel} in ${periodLabel} from ask_nac_structured_facts. This does not establish that no incidents occurred. Check branch access, the date window, and structured-fact coverage before treating the result as a verified zero.`,
      keyMetrics: [],
      insights: [],
      recommendations: [],
      confidence: "none",
      logbookDays: 0,
      readyDays,
      groupedFindings: [],
      vaultSources: [],
    };
  }

  if (FOCUS_LABELS[mode]) {
    return buildFocusedNarrativeSummary({
      facts,
      coverage,
      branchLabel,
      periodLabel,
      mode,
      compareSummary,
    });
  }

  const evidenceLedger = buildOperationalEvidenceLedger(facts);
  const themes = extractThemes(days);
  const recurring = recurringThemes(themes);
  const reception = aggregateReception(days);
  const google = aggregateGoogle(days);

  const trafficQuiet = themes.find((t) => t.id === "traffic_quiet");
  const trafficBusy = themes.find((t) => t.id === "traffic_busy");
  const complaints = themes.filter((t) => t.id === "complaint");
  const maintenance = themes.filter((t) => t.id === "maintenance");
  const staffing = themes.filter((t) => t.id === "staffing_system");

  const executiveLead =
    mode === "recurring"
      ? `${branchLabel} ${periodLabel}: ${recurring.length ? `${recurring.length} recurring operational theme(s) across ${logbookDays} logbook day(s).` : `No strong recurring themes across ${logbookDays} logbook day(s).`}`
      : mode === "issues"
        ? `${branchLabel} ${periodLabel}: main operational issues drawn from ${logbookDays} recovered daily logbooks.`
        : `${branchLabel} ${periodLabel}: executive operational summary across ${logbookDays} recovered daily logbooks (${readyDays} ready).`;

  const sections = [
    buildSection("Executive Summary", [executiveLead]),
    buildSection("Traffic / demand pattern", [
      trafficQuiet ? `Quiet/low-demand days noted on ${trafficQuiet.count} logbook(s). Example: ${trafficQuiet.examples[0]}` : null,
      trafficBusy ? `Busy periods noted on ${trafficBusy.count} logbook(s). Example: ${trafficBusy.examples[0]}` : null,
      !trafficQuiet && !trafficBusy ? "Traffic pattern mixed; review shift notes for day-by-day demand." : null,
    ]),
    buildSection("Guest complaints", complaints.flatMap((t) => t.examples.slice(0, 3))),
    buildSection("Maintenance / facility issues", maintenance.flatMap((t) => t.examples.slice(0, 3))),
    buildSection("Staffing / system issues", staffing.flatMap((t) => t.examples.slice(0, 3))),
    buildSection("Google review trend", [
      google.totalReviews
        ? `${google.totalReviews} review events logged across ${google.daysWith} day(s): 5★ ${google.totals.google_review_5}, 4★ ${google.totals.google_review_4}, 3★ ${google.totals.google_review_3}, 2★ ${google.totals.google_review_2}, 1★ ${google.totals.google_review_1}.`
        : "No structured Google review totals in recovered logbooks for this month.",
    ]),
    buildSection("Reception totals", [
      reception.daysWith
        ? `Month aggregate from ${reception.daysWith} logbook reception table(s): ${reception.totals.covers.toLocaleString()} covers, ${reception.totals.reservations.toLocaleString()} reservations, ${reception.totals.walkins.toLocaleString()} walk-ins, ${reception.totals.no_shows.toLocaleString()} no-shows, ${reception.totals.cancellations.toLocaleString()} cancellations.`
        : "No structured reception totals in recovered logbooks for this month.",
    ]),
    buildSection("Recurring themes", recurring.length
      ? recurring.map((t) => `${t.label} (${t.count} day(s)) — ${t.examples[0]}`)
      : ["No recurring themes reached the 2+ day threshold this month."]),
    buildSection("Recommended actions", [
      complaints.length ? "Review repeat guest complaint types with floor MOD and kitchen lead." : null,
      maintenance.length ? "Track open maintenance items (facilities/CCM) until closed in logbook." : null,
      staffing.length ? "Follow up on staffing/system issues (e.g. Jisr, inventory, upsell execution)." : null,
      readyDays < logbookDays ? `${logbookDays - readyDays} logbook day(s) still partial — finish recovery for fuller month coverage.` : null,
    ]),
    buildSection("Source coverage / confidence", [
      `${logbookDays} logbook day(s) with structured facts; ${readyDays} ready coverage row(s).`,
      `Confidence: ${confidence} (based on recovered day coverage).`,
      `Sources: daily_logbook structured facts for ${periodLabel}.`,
    ]),
  ].filter(Boolean);

  if (compareSummary) {
    sections.push(buildSection("Month comparison", compareSummary));
  }

  const directAnswer = sections.join("\n\n");

  const groupedFindings = evidenceLedger.map((entry) => ({
    date: entry.date,
    issueType: entry.issueType,
    severity: "medium",
    excerpt: snippet(entry.text, 180),
    source: entry.fileTitle || entry.date,
    fileTitle: entry.fileTitle,
    section: entry.section,
    themes: entry.themes,
  }));

  const vaultSources = [...new Map(
    days.filter((d) => d.fileId && d.fileTitle).map((d) => [d.fileId, {
      fileId: d.fileId,
      title: d.fileTitle,
      reportType: "daily_logbook",
      periodStart: d.date,
      periodEnd: d.date,
    }]),
  ).values()];

  const keyMetrics = [
    { label: "Logbook days covered", value: String(logbookDays) },
    { label: "Ready coverage rows", value: String(readyDays) },
    ...(reception.totals.covers ? [{ label: "Month covers (sum)", value: reception.totals.covers.toLocaleString() }] : []),
    ...(google.totalReviews ? [{ label: "Google reviews logged", value: String(google.totalReviews) }] : []),
  ];

  const insights = groupedFindings.slice(0, 8).map(
    (item) => `${item.date || item.fileTitle} · ${item.issueType}: ${item.excerpt}`,
  );

  return {
    title: `Operational summary · ${branchLabel} · ${periodLabel}`,
    directAnswer,
    keyMetrics,
    insights,
    recommendations: [
      `Based on ${logbookDays} recovered logbook day(s) for ${periodLabel}.`,
      readyDays < logbookDays ? "Some days remain partial — recovery will improve month completeness." : null,
    ].filter(Boolean),
    confidence: confidenceLevelToEnum(confidence),
    logbookDays,
    readyDays,
    groupedFindings,
    evidenceLedger,
    vaultSources,
  };
}

export function buildMonthlyLogbookCompareSummary(currentSummary, previousSummary) {
  if (!currentSummary?.logbookDays || !previousSummary?.logbookDays) {
    return ["Insufficient structured logbook coverage in one or both months for theme comparison."];
  }
  return [
    `${currentSummary.periodLabel || "Current month"}: ${currentSummary.logbookDays} logbook day(s), confidence ${currentSummary.confidence}.`,
    `${previousSummary.periodLabel || "Previous month"}: ${previousSummary.logbookDays} logbook day(s), confidence ${previousSummary.confidence}.`,
    "Compare guest complaints, maintenance notes, and traffic language between months in the sections above.",
  ];
}

export { groupFactsByDay };
