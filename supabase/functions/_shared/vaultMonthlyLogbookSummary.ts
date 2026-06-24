/**
 * Deterministic monthly executive summary from recovered daily_logbook structured facts.
 */

import { classifyOperationalIssue } from "./vaultDocumentSearchRanking.ts";
import { extractDateFromFileTitle } from "./vaultOperationalIntelligence.ts";

const TEXT_KEYS = [
  "complaints",
  "operational_issues",
  "operational_highlights",
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
  { id: "complaint", label: "Guest complaints", re: /\b(complain|complaint|refused|undercooked|charge|remove from bill|insect|fly|halloumi|cappuccino|spanish|upset)\b/i },
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
      directAnswer: `No recovered daily logbook structured facts were found for ${branchLabel} in ${periodLabel}.`,
      keyMetrics: [],
      insights: [],
      recommendations: ["Upload or re-index daily logbooks for this month, then retry."],
      confidence: "none",
      logbookDays: 0,
      readyDays,
      groupedFindings: [],
      vaultSources: [],
    };
  }

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

  const groupedFindings = days.flatMap((day) => {
    const blob = collectDayTexts(day);
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
    logbookDays,
    readyDays,
    groupedFindings,
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
