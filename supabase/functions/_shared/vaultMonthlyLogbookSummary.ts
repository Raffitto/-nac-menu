/**
 * Deterministic monthly executive summary from recovered daily_logbook structured facts.
 */

import { classifyOperationalIssue } from "./vaultDocumentSearchRanking.ts";
import { extractDateFromFileTitle } from "./vaultOperationalIntelligence.ts";

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
  { id: "complaint", label: "Guest complaints", re: /\b(complain|complaint|refused|undercooked|overcooked|oily|smell|smelled|bad smell|raw|wrong|burnt|cold food|tenderness|saltiness|remove from bill|insect|fly|upset)\b/i },
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

function incidentSentences(day) {
  const parts = TEXT_KEYS.flatMap((key) => String(day.texts[key] || "")
    .split(/\s*[•\n\r]+\s*|(?<=[.!?])\s+(?=[A-Z])/g)
    .map((value) => value.trim()).filter(Boolean));
  const incident = /\b(complain(?:ed|ing|t|ts)?|undercook(?:ed)?|overcook(?:ed)?|oily|smell(?:ed)?|bad smell|raw|wrong|burnt|cold food|tenderness|saltiness|remove(?:d)? from (?:the )?(?:bill|check)|insect|fly|upset|delay(?:ed)?|returned|refused|replaced|issue|problem|broken|repair|maintenance|shortage)\b/i;
  const routine = /\b(no (?:major )?(?:issues?|problems?|complaints?|86)|nothing to report|all tables (?:were )?happy|smooth operations?|overall slow business)\b/gi;
  return [...new Set(parts.filter((piece) => incident.test(piece.replace(routine, ""))))];
}

function extractThemes(days) {
  const themes = new Map();
  for (const day of days) {
    const incidents = incidentSentences(day);
    for (const rule of THEME_RULES) {
      if (rule.id.startsWith("traffic_")) continue;
      const matching = incidents.filter((line) => rule.re.test(line));
      if (!matching.length) continue;
      if (!themes.has(rule.id)) themes.set(rule.id, { id: rule.id, label: rule.label, count: 0, examples: [] });
      const entry = themes.get(rule.id);
      entry.count += 1;
      for (const line of matching) {
        if (entry.examples.length < 4) entry.examples.push(formatDayLabel(day) + ": " + snippet(line, 240));
      }
    }
  }
  return [...themes.values()].sort((a, b) => b.count - a.count);
}

function recurringThemes(themes) {
  return themes.filter((theme) => theme.count >= 2 || /complaint|maintenance|staffing_system/.test(theme.id));
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

const SECTION_LABELS: Record<string, string> = {
  breakfast_notes: "Breakfast",
  lunch_notes: "Lunch",
  dinner_notes: "Dinner",
  complaints: "Complaints",
  operational_issues: "Operational issues",
  operational_highlights: "Highlights",
  training_notes: "Training",
  staff_performance_notes: "Staff performance",
};

const FOCUS_LABELS: Record<string, string> = {
  complaints: "guest complaints",
  maintenance: "maintenance incidents",
  staff: "staff performance notes",
  food_quality: "food-quality issues",
  beverage: "beverage-quality issues",
  service: "service problems",
};

function narrativeText(fact: Record<string, any>) {
  const dims = fact?.dimensions || {};
  return String(dims.text_value || "").replace(/\s+/g, " ").trim();
}

function withoutNegatedAbsences(text: string) {
  return String(text || "").replace(/\bno\s+(?:major\s+)?(?:issues?|problems?|complaints?|86)\b/gi, " ");
}

function matchesFocus(mode: string, text: string, fact: Record<string, any>) {
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

function recordedAction(text: string) {
  const match = String(text || "").match(/\b(?:kitchen |service )?(?:remade|replaced|removed from (?:the )?bill|comped|refunded|apolog(?:ized|ised)|resolved|guest (?:was )?satisfied)[^.]*/i);
  return match ? match[0].trim() : null;
}

function formatIncidentDate(iso: string | null) {
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

function narrativeCoverage(facts: Record<string, any>[] = []) {
  const breakfast = new Set<string>();
  const lunch = new Set<string>();
  const dinner = new Set<string>();
  const any = new Set<string>();
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
}: {
  facts?: Record<string, any>[];
  coverage?: Record<string, any>[];
  branchLabel?: string;
  periodLabel?: string;
  mode?: string;
  compareSummary?: string[] | null;
} = {}) {
  const label = FOCUS_LABELS[mode] || "operational incidents";
  const readyDays = (coverage || []).filter((row) => row.readinessStatus === "ready").length;
  const coverageCounts = narrativeCoverage(facts);
  const incidents: Record<string, any>[] = [];
  const seen = new Set<string>();
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

  const repeated = new Map<string, Set<string>>();
  for (const item of incidents) {
    const key = String(item.text || "").split(/[.!?]/)[0].toLowerCase().replace(/\s+/g, " ").trim();
    if (!repeated.has(key)) repeated.set(key, new Set());
    if (item.date) repeated.get(key)!.add(item.date);
  }
  const recurring = [...repeated.entries()].filter(([, dates]) => dates.size >= 2);

  let directAnswer: string;
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

  if (mode === "complaints" || mode === "maintenance" || mode === "staff" || mode === "food_quality" || mode === "beverage" || mode === "service") {
    const focused = buildFocusedNarrativeSummary({ facts, coverage, branchLabel, periodLabel, mode, compareSummary });
    return focused;
  }

  const themes = extractThemes(days);
  const recurring = recurringThemes(themes);
  const reception = aggregateReception(days);
  const google = aggregateGoogle(days);

  const trafficQuiet = null;
  const trafficBusy = null;
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
    buildSection("Guest complaints", complaints.flatMap((t) => t.examples.slice(0, 3))),
    buildSection("Maintenance / facility issues", maintenance.flatMap((t) => t.examples.slice(0, 3))),
    buildSection("Staffing / system issues", staffing.flatMap((t) => t.examples.slice(0, 3))),
    mode === "summary" ? buildSection("Traffic / demand pattern", [
      trafficQuiet ? `Quiet/low-demand days noted on ${trafficQuiet.count} logbook(s). Example: ${trafficQuiet.examples[0]}` : null,
      trafficBusy ? `Busy periods noted on ${trafficBusy.count} logbook(s). Example: ${trafficBusy.examples[0]}` : null,
      !trafficQuiet && !trafficBusy ? "Demand is not assessed in the incident-only view." : null,
    ]) : null,
    mode === "summary" ? buildSection("Google review trend", [
      google.totalReviews
        ? `${google.totalReviews} review events logged across ${google.daysWith} day(s): 5★ ${google.totals.google_review_5}, 4★ ${google.totals.google_review_4}, 3★ ${google.totals.google_review_3}, 2★ ${google.totals.google_review_2}, 1★ ${google.totals.google_review_1}.`
        : "No structured Google review totals in recovered logbooks for this month.",
    ]) : null,
    mode === "summary" ? buildSection("Reception totals", [
      reception.daysWith
        ? `Month aggregate from ${reception.daysWith} logbook reception table(s): ${reception.totals.covers.toLocaleString()} covers, ${reception.totals.reservations.toLocaleString()} reservations, ${reception.totals.walkins.toLocaleString()} walk-ins, ${reception.totals.no_shows.toLocaleString()} no-shows, ${reception.totals.cancellations.toLocaleString()} cancellations.`
        : "No structured reception totals in recovered logbooks for this month.",
    ]) : null,
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

  const groupedFindings = days.flatMap((day) => {
    const blob = incidentSentences(day).join(" • ");
    if (!blob) return [];
    return [{
      date: day.date || extractDateFromFileTitle(day.fileTitle),
      issueType: classifyOperationalIssue(blob),
      severity: "medium",
      excerpt: snippet(blob, 180),
      source: day.fileTitle || day.date,
      fileTitle: day.fileTitle,
    }];
  }).slice(0, 12);

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
    periodLabel,
    issueCounts: Object.fromEntries(themes.map((theme) => [theme.id, theme.count])),
    logbookDays,
    readyDays,
    groupedFindings,
    vaultSources,
  };
}

export function buildMonthlyLogbookCompareSummary(currentSummary, previousSummary) {
  if (!currentSummary?.logbookDays || !previousSummary?.logbookDays) {
    return ["Insufficient structured logbook coverage in one or both months; no improvement or deterioration can be inferred."];
  }
  const keys = [
    ["complaint", "Guest-complaint days"],
    ["maintenance", "Maintenance-issue days"],
    ["staffing_system", "Staff/system-issue days"],
  ];
  const lines = [
    currentSummary.periodLabel + ": " + currentSummary.logbookDays + " logbook day(s), confidence " + currentSummary.confidence + ".",
    previousSummary.periodLabel + ": " + previousSummary.logbookDays + " logbook day(s), confidence " + previousSummary.confidence + ".",
  ];
  for (const [key, label] of keys) {
    const current = Number(currentSummary.issueCounts?.[key] || 0);
    const previous = Number(previousSummary.issueCounts?.[key] || 0);
    lines.push(label + ": " + current + "/" + currentSummary.logbookDays + " days vs " + previous + "/" + previousSummary.logbookDays + " days.");
  }
  lines.push("Counts are documented issue-day occurrences, not verified incident totals; differing coverage prevents definitive improvement claims.");
  return lines;
}

export { groupFactsByDay };
