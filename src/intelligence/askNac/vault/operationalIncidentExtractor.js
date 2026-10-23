/**
 * Split recovered logbook narratives into distinct operational incidents.
 * A shift note can contain several incidents, a negation, and unrelated observations.
 */

const NEGATED_COMPLAINT =
  /\bno\s+(?:guest\s+)?complain(?:ed|ing|t|ts)?\b|\bno\s+complaints?\b|\bno\s+(?:major\s+)?(?:issues?|problems?)\s*(?:reported|noted|today|recorded)?\b|\bnobody\s+complained\b|\bno\s+one\s+complained\b|\bno\s+issues?\s+reported\b|\bdid(?:\s+not|n['’]t)\s+complain\b/i;

const COMPLAINT_TRIGGER =
  /\b(complain(?:ed|ing|ts?)|became\s+upset|was\s+upset|guest\s+(?:was\s+)?upset|unhappy|dissatisfied)\b/i;

const MAINTENANCE_TRIGGER =
  /\b(pest\s+control|repair(?:ed|ing)?|replaced|electrician|drainage|leak(?:ing)?|hvac|fly\s+trap|maintenance|equipment\s+(?:down|failed|stopped)|ice cream machine)\b/i;

const STAFF_TRIGGER =
  /\b(server\s+was\s+late|late\s+arrival|understaffed|short[- ]staffed|sick\s+leave|staff\s+performance|absent)\b/i;

const SATISFACTION =
  /\b(guest\s+(?:was\s+)?satisfied|left\s+satisfied|happy\s+with\s+the\s+(?:resolution|outcome)|resolution\s+accepted)\b/i;

export function splitNarrativeClauses(text = "") {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const marked = normalized
    .replace(/\s+(?=Table\s+\d+\b)/gi, "\n")
    .replace(/\s+(?=No\s+(?:guest\s+)?complain)/gi, "\n")
    .replace(/\s+(?=No\s+complaints?\b)/gi, "\n")
    .replace(/\s+(?=No\s+issues?\s+reported\b)/gi, "\n")
    .replace(/\s+(?=Nobody\s+complained\b)/gi, "\n")
    .replace(/\s+(?=Pest\s+control\b)/gi, "\n")
    .replace(/\s*[•;]\s*/g, "\n");
  return marked
    .split(/(?<=[.!?])\s+|\n+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

export function isNegatedComplaint(clause = "") {
  if (!clause) return false;
  if (/\btable\s+\d+\s+complain/i.test(clause)) return false;
  if (/\bno\b[^.]{0,40}\bcomplain/i.test(clause)) return true;
  if (COMPLAINT_TRIGGER.test(clause) && !/\bno\s+(?:guest\s+)?complain/i.test(clause)) return false;
  return NEGATED_COMPLAINT.test(clause);
}

export function isComplaintClause(clause = "") {
  if (!clause || isNegatedComplaint(clause)) return false;
  return COMPLAINT_TRIGGER.test(clause);
}

export function isMaintenanceClause(clause = "") {
  if (!clause || isComplaintClause(clause)) return false;
  return MAINTENANCE_TRIGGER.test(clause);
}

function isStaffClause(clause = "", metricKey = "") {
  if (metricKey === "staff_performance_notes" && !isComplaintClause(clause) && !isNegatedComplaint(clause)) {
    return true;
  }
  return STAFF_TRIGGER.test(clause) && !isComplaintClause(clause);
}

function isActionContinuation(clause = "") {
  return /\b(offered|removed|tasted|refus(?:ed|al)|declin(?:ed|e)|replacement|comped|refund(?:ed)?|apolog|remade|replaced)\b/i.test(clause)
    && !isComplaintClause(clause)
    && !isMaintenanceClause(clause);
}

function tableNumber(clause = "") {
  const match = String(clause).match(/\btable\s+(\d+)\b/i);
  return match ? match[1] : null;
}

function cleanPhrase(value = "") {
  return String(value || "").replace(/\s+/g, " ").replace(/[.,;:]+$/g, "").trim();
}

function titleCase(value = "") {
  return cleanPhrase(value).replace(/\w\S*/g, (word) => {
    if (word.length <= 2 && word === word.toUpperCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

function subjectFromComplaint(clause = "") {
  const about = clause.match(/\b(?:complain(?:ed|ing)?\s+about|became\s+upset\s+about|upset\s+about|was\s+upset\s+about)\s+(.+)$/i);
  const raw = cleanPhrase(about ? about[1] : "");
  if (!raw) {
    if (/\bservice\s+was\s+slow\b/i.test(clause)) return { product: "Service", issue: "slow service", category: "service" };
    if (/\brude\b/i.test(clause)) return { product: "Service", issue: "rude service", category: "service" };
    return { product: "Guest complaint", issue: "guest complaint", category: "guest_complaint" };
  }
  if (/\btasting\s+different\b/i.test(raw)) {
    return {
      product: titleCase(raw.replace(/\s+tasting\s+different.*$/i, "")),
      issue: "inconsistent taste",
      category: "food_quality",
    };
  }
  if (/\bservice\s+sequence\b/i.test(raw)) {
    return {
      product: titleCase(raw.replace(/\s+service\s+sequence.*$/i, "").replace(/^(?:the|a|an)\s+/i, "")),
      issue: "service sequence",
      category: "service",
    };
  }
  const taste = raw.match(/^(.+?)\s+taste\b(.*)$/i);
  if (taste) {
    const rest = cleanPhrase(taste[2]).replace(/^and\s+/i, "");
    return {
      product: titleCase(taste[1]),
      issue: rest ? `taste and ${rest}` : "taste",
      category: "food_quality",
    };
  }
  if (/\b(cold|late|undercooked|overcooked|raw|burnt|spicy|bland)\b/i.test(raw) && /\b(food|eggs?|steak|salad|toast|chicken|fries|pasta|drink|coffee)\b/i.test(raw)) {
    return { product: titleCase(raw), issue: raw.toLowerCase(), category: "food_quality" };
  }
  if (/\b(service|wait|rude|sequence)\b/i.test(raw)) {
    return { product: titleCase(raw), issue: raw.toLowerCase(), category: "service" };
  }
  if (/\bfood\b/i.test(raw)) {
    return { product: titleCase(raw), issue: raw.toLowerCase(), category: "food_quality" };
  }
  return { product: titleCase(raw), issue: raw.toLowerCase(), category: "guest_complaint" };
}

function describeIssue(table, clause, subject) {
  const who = table ? `Table ${table}` : "A guest";
  if (subject.issue === "inconsistent taste") return `${who} reported inconsistent taste.`;
  if (subject.issue === "service sequence") return `${who} became upset about the service sequence.`;
  if (subject.issue === "slow service") return `${who} reported that service was slow.`;
  if (subject.category === "food_quality" && /taste/i.test(subject.issue)) {
    return `${who} complained about ${subject.issue}.`;
  }
  if (subject.product && subject.product !== "Guest complaint" && subject.product !== "Service") {
    return `${who} complained about ${subject.product.toLowerCase()}.`;
  }
  return `${who} raised a guest complaint.`;
}

function summarizeAction(clauses = []) {
  const actionClauses = clauses.slice(1).filter(Boolean);
  const text = actionClauses.join(" ");
  if (!text.trim()) return null;
  const recovery = text.match(/\boffered\s+(.{2,48}?)\s+as\s+recovery\b/i);
  if (recovery) return `${titleCase(recovery[1])} offered as recovery.`;
  const offered = /\b(offered|replacement\s+was\s+offered)\b/i.test(text);
  const declined = /\b(refus(?:ed|al)|declin(?:ed|e))\b/i.test(text);
  const removed = /\bremoved\b[^.]{0,60}\bfrom\s+(?:the\s+)?bill\b/i.test(text);
  if (offered || removed || declined) {
    const parts = [];
    if (offered && declined) parts.push("Replacement offered and declined");
    else if (offered) parts.push("Replacement offered");
    if (removed) parts.push("item removed from bill");
    return `${parts.join("; ")}.`;
  }
  if (actionClauses.length === 1 && actionClauses[0].length <= 110) {
    return actionClauses[0].replace(/\.$/, "") + ".";
  }
  return null;
}

function resolutionStatus(text = "") {
  if (SATISFACTION.test(text)) return "Guest satisfaction recorded.";
  return "Final satisfaction not documented.";
}

function formatDay(iso) {
  if (!iso) return "Undated";
  const [year, month, day] = String(iso).split("-").map(Number);
  if (!year || !month || !day) return String(iso);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function categoryLabel(category) {
  if (category === "food_quality") return "Food quality";
  if (category === "service") return "Service";
  if (category === "maintenance") return "Maintenance";
  if (category === "staff") return "Staff performance";
  return "Guest complaint";
}

function incidentConfidence(incident) {
  if (incident.kind !== "complaint") return incident.evidenceExcerpt ? "medium" : "low";
  if (incident.tableNumber && incident.product && incident.product !== "Guest complaint") return "high";
  if (incident.product) return "medium";
  return "low";
}

function buildComplaintIncident(clauses, context) {
  const opening = clauses[0];
  const subject = subjectFromComplaint(opening);
  const table = tableNumber(opening);
  const excerpt = clauses.join(" ");
  const action = summarizeAction(clauses);
  return {
    kind: "complaint",
    date: context.date || null,
    dateLabel: formatDay(context.date),
    branch: context.branch || null,
    servicePeriod: context.servicePeriod || null,
    tableNumber: table,
    category: subject.category,
    categoryLabel: categoryLabel(subject.category),
    product: subject.product,
    issue: describeIssue(table, opening, subject),
    action,
    resolution: resolutionStatus(excerpt),
    satisfactionKnown: SATISFACTION.test(excerpt),
    sourceDocument: context.sourceDocument || "daily logbook",
    sourceSection: context.servicePeriod || context.section || null,
    provenance: context.provenance || null,
    evidenceExcerpt: excerpt,
    metricKey: context.metricKey || null,
  };
}

function equipmentName(text = "") {
  const named = String(text).match(/\b(ice cream machine|pest control|fly trap|fryer|oven|dishwasher|fridge|freezer|hvac|air conditioner|ac unit)\b/i);
  return named ? named[1] : null;
}

function buildObservationIncident(kind, clause, context) {
  const equipment = equipmentName(clause);
  const completed = /\b(repaired|replaced|completed|fixed|checked)\b/i.test(clause);
  return {
    kind,
    date: context.date || null,
    dateLabel: formatDay(context.date),
    branch: context.branch || null,
    servicePeriod: context.servicePeriod || null,
    tableNumber: null,
    category: kind,
    categoryLabel: categoryLabel(kind),
    product: equipment ? titleCase(equipment) : (kind === "maintenance" ? "Facilities" : "Staff"),
    issue: clause.replace(/\.$/, "") + (/\.$/.test(clause) ? "" : "."),
    action: completed ? "Work recorded in the logbook." : null,
    resolution: kind === "maintenance"
      ? (completed ? "Logged as carried out. This is not a guest outcome." : "Completion was not documented.")
      : "This is a staff observation, not a guest-satisfaction result.",
    satisfactionKnown: false,
    sourceDocument: context.sourceDocument || "daily logbook",
    sourceSection: context.servicePeriod || context.section || null,
    provenance: context.provenance || null,
    evidenceExcerpt: clause,
    metricKey: context.metricKey || null,
  };
}

export function extractIncidentsFromNarrative(text = "", context = {}) {
  const clauses = splitNarrativeClauses(text);
  const incidents = [];
  let open = null;
  const flush = () => {
    if (!open) return;
    incidents.push(buildComplaintIncident(open, context));
    open = null;
  };
  for (const clause of clauses) {
    if (isNegatedComplaint(clause)) {
      flush();
      continue;
    }
    if (isComplaintClause(clause)) {
      flush();
      open = [clause];
      continue;
    }
    if (open && isActionContinuation(clause)) {
      open.push(clause);
      continue;
    }
    flush();
    if (isMaintenanceClause(clause)) incidents.push(buildObservationIncident("maintenance", clause, context));
    else if (isStaffClause(clause, context.metricKey)) incidents.push(buildObservationIncident("staff", clause, context));
  }
  flush();
  return incidents.map((incident) => ({ ...incident, confidence: incidentConfidence(incident) }));
}

function matchesMode(incident, mode) {
  if (mode === "executive_operational" || mode === "resolution") {
    return incident.kind === "complaint" || incident.kind === "maintenance" || incident.kind === "staff";
  }
  if (mode === "maintenance") return incident.kind === "maintenance";
  if (mode === "staff") return incident.kind === "staff";
  if (mode === "food_quality") return incident.kind === "complaint" && incident.category === "food_quality";
  if (mode === "service") return incident.kind === "complaint" && incident.category === "service";
  if (mode === "beverage") return incident.kind === "complaint" && incident.category === "beverage";
  return incident.kind === "complaint";
}

function dedupeKey(incident) {
  return [
    incident.date,
    incident.servicePeriod,
    incident.tableNumber || "",
    incident.kind,
    String(incident.product || "").toLowerCase(),
    String(incident.issue || "").toLowerCase(),
  ].join("|");
}

function sourceLine(incident) {
  const provenance = incident.provenance ? `. Provenance: ${incident.provenance}` : "";
  const section = incident.sourceSection ? `, ${incident.sourceSection}` : "";
  return `Source: ${incident.sourceDocument}${section} (${incident.date || "undated"})${provenance}.`;
}

function renderIncident(incident) {
  const title = `${incident.dateLabel}${incident.product ? ` — ${incident.product}` : ""}`;
  const lines = [title, incident.issue];
  if (incident.action) lines.push(`Action: ${incident.action}`);
  lines.push(`Outcome: ${incident.resolution}`);
  lines.push(sourceLine(incident));
  return lines.join("\n");
}

function analyze(incidents) {
  const insights = [];
  const recommendations = [];
  if (!incidents.length) return { insights, recommendations, recurring: [] };
  const byCategory = new Map();
  for (const incident of incidents) {
    byCategory.set(incident.categoryLabel, (byCategory.get(incident.categoryLabel) || 0) + 1);
  }
  const categorySummary = [...byCategory.entries()].map(([label, count]) => `${count} ${label.toLowerCase()}`).join(", ");
  insights.push(`${incidents.length} documented item(s): ${categorySummary}.`);
  const unknown = incidents.filter((item) => item.kind === "complaint" && !item.satisfactionKnown);
  const removed = incidents.filter((item) => /removed from bill/i.test(item.action || ""));
  if (removed.length) {
    insights.push(`${removed.length} incident(s) record removal from the bill. That is a commercial action, not evidence the guest was satisfied.`);
  }
  if (unknown.length) {
    insights.push(`Final guest satisfaction is not documented for ${unknown.length} complaint(s).`);
  }
  const themeDays = new Map();
  for (const incident of incidents) {
    const specific = incident.kind === "maintenance"
      ? (equipmentName(incident.evidenceExcerpt || "") || "").toLowerCase()
      : "";
    const taste = incident.category === "food_quality" && /inconsistent taste|taste/i.test(incident.issue) ? "inconsistent taste" : "";
    const key = specific || taste || (incident.product && !["Facilities", "Staff", "Guest complaint", "Service"].includes(incident.product)
      ? incident.product.toLowerCase()
      : "");
    if (!key) continue;
    if (!themeDays.has(key)) themeDays.set(key, new Set());
    if (incident.date) themeDays.get(key).add(incident.date);
  }
  const recurring = [...themeDays.entries()]
    .filter(([, dates]) => dates.size >= 2)
    .map(([theme, dates]) => ({ theme, days: dates.size }));
  if (recurring.length) {
    insights.push(`Recurring across different days: ${recurring.map((item) => `${item.theme} (${item.days} days)`).join("; ")}.`);
  }
  const products = [...new Set(incidents.map((item) => item.product).filter((name) => name && !["Facilities", "Staff", "Guest complaint", "Service"].includes(name)))];
  if (products.length >= 2 && incidents.some((item) => item.category === "food_quality")) {
    recommendations.push(`Compare the recorded food notes (${products.join(", ")}) with the kitchen lead before the next service.`);
  }
  if (removed.length && unknown.length && incidents.some((item) => item.kind === "complaint")) {
    recommendations.push("After a bill removal or recovery offer, record whether the guest accepted the outcome. Do not treat the action itself as satisfaction.");
  }
  if (!recommendations.length && incidents.length) {
    recommendations.push("Review the incident register with the duty manager and record any outcome that is still missing.");
  }
  return { insights, recommendations, recurring };
}

function buildPriorities(incidents) {
  const lines = [];
  const food = incidents.filter((item) => item.category === "food_quality");
  const service = incidents.filter((item) => item.category === "service");
  const maintenance = incidents.filter((item) => item.kind === "maintenance");
  const unresolved = incidents.filter((item) => item.kind === "complaint" && !item.satisfactionKnown);
  if (food.length) {
    lines.push(`Food-quality notes on ${[...new Set(food.map((item) => item.dateLabel))].join(", ")} (${[...new Set(food.map((item) => item.product))].join(", ")}). Check the prep spec with the kitchen lead.`);
  }
  if (unresolved.length) {
    lines.push(`${unresolved.length} guest incident(s) do not record whether the guest accepted the outcome. A bill removal is not satisfaction.`);
  }
  if (service.length) {
    lines.push(`Service incidents on ${[...new Set(service.map((item) => item.dateLabel))].join(", ")}. Review the sequence with the floor lead.`);
  }
  if (maintenance.length && lines.length < 3) {
    lines.push(`Facilities notes on ${maintenance.map((item) => `${item.dateLabel} ${item.product}`).join("; ")}. Confirm which jobs are closed.`);
  }
  if (!lines.length) lines.push("The recovered narratives do not support an additional priority beyond the incident register.");
  return lines.slice(0, 3);
}

export function buildIncidentRegister({
  facts = [],
  branchLabel = "Branch",
  periodLabel = "Period",
  mode = "complaints",
  textKeys = [],
  sectionLabels = {},
  compareSummary = null,
}) {
  const collected = [];
  const seen = new Set();
  for (const fact of facts) {
    if (textKeys.length && !textKeys.includes(fact.metricKey)) continue;
    const text = String(fact.dimensions?.text_value || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const extracted = extractIncidentsFromNarrative(text, {
      date: fact.periodStart || null,
      branch: branchLabel,
      servicePeriod: sectionLabels[fact.metricKey] || fact.metricKey,
      section: sectionLabels[fact.metricKey] || fact.metricKey,
      sourceDocument: fact.fileTitle || fact.fileId || "daily logbook",
      provenance: fact.dimensions?.provenance || null,
      metricKey: fact.metricKey,
    });
    for (const incident of extracted) {
      if (!matchesMode(incident, mode)) continue;
      const key = dedupeKey(incident);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(incident);
    }
  }
  collected.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.tableNumber || "").localeCompare(String(b.tableNumber || "")));

  const label = mode === "maintenance"
    ? "maintenance incidents"
    : mode === "staff"
      ? "staff observations"
      : mode === "food_quality"
        ? "food-quality complaints"
        : mode === "service"
          ? "service complaints"
          : mode === "executive_operational"
            ? "operational findings"
            : mode === "resolution"
              ? "complaint follow-up"
              : "guest complaints";
  const heading = `${String(branchLabel || "Branch").toUpperCase()} ${label.toUpperCase()}`;
  const analysis = analyze(collected.filter((item) => item.kind === "complaint" || mode === "maintenance" || mode === "staff" || mode === "executive_operational"));
  const narrativeDays = new Set(facts.filter((fact) => String(fact.dimensions?.text_value || "").trim()).map((fact) => fact.periodStart)).size;
  const complaints = collected.filter((item) => item.kind === "complaint");
  const satisfied = complaints.filter((item) => item.satisfactionKnown);
  const followUp = complaints.filter((item) => !item.satisfactionKnown);
  let body = collected.map(renderIncident).join("\n\n");
  if (mode === "resolution") {
    body = [
      `Documented guest satisfaction: ${satisfied.length}.`,
      satisfied.map(renderIncident).join("\n\n"),
      `Still requiring follow-up because satisfaction was not recorded: ${followUp.length}.`,
      "A management action such as removing an item from the bill is not confirmation that the guest was satisfied.",
      followUp.map(renderIncident).join("\n\n"),
    ].filter(Boolean).join("\n\n");
  }
  if (mode === "executive_operational") {
    const priorities = buildPriorities(collected);
    body = `${body}\n\nPriorities supported by these records\n${priorities.map((line, index) => `${index + 1}. ${line}`).join("\n")}`;
  }
  const countLine = collected.length
    ? `Reviewed ${narrativeDays} narrative day(s). ${collected.length} documented ${collected.length === 1 ? "item" : "items"} identified.`
    : `Reviewed ${narrativeDays} narrative day(s). No ${label} were identified in the recovered narratives. This does not prove that no incident occurred.`;
  const directAnswer = [
    heading,
    periodLabel,
    "",
    countLine,
    body ? `\n${body}` : null,
    analysis.recurring.length && mode !== "maintenance" && mode !== "staff"
      ? `\nRecurring theme: ${analysis.recurring.map((item) => `${item.theme} on ${item.days} days`).join("; ")}.`
      : null,
    compareSummary?.length ? `\nComparison\n${compareSummary.map((line) => `- ${line}`).join("\n")}` : null,
  ].filter((line) => line != null).join("\n");

  const categoryCounts = new Map();
  for (const incident of collected) {
    categoryCounts.set(incident.categoryLabel, (categoryCounts.get(incident.categoryLabel) || 0) + 1);
  }

  return {
    title: `${label[0].toUpperCase()}${label.slice(1)} · ${branchLabel} · ${periodLabel}`,
    directAnswer,
    keyMetrics: [
      { label: "Documented incidents", value: String(collected.length) },
      ...[...categoryCounts.entries()].map(([name, count]) => ({ label: name, value: String(count) })),
    ],
    insights: analysis.insights,
    recommendations: analysis.recommendations,
    confidence: collected.length && narrativeDays > 0 ? "medium" : "none",
    logbookDays: new Set(collected.map((item) => item.date).filter(Boolean)).size,
    operationalFindings: collected,
    groupedFindings: collected.map((item) => ({
      date: item.date,
      issueType: item.category,
      severity: "medium",
      excerpt: item.issue,
      source: item.sourceDocument,
      fileTitle: item.sourceDocument,
      section: item.sourceSection,
    })),
    vaultSources: [...new Map(collected.map((item) => [item.sourceDocument, {
      fileId: item.sourceDocument,
      title: item.sourceDocument,
      reportType: "daily_logbook",
      periodStart: item.date,
      periodEnd: item.date,
    }])).values()],
  };
}
