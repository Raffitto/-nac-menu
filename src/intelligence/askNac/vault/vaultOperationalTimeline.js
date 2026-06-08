/**
 * Build operational timeline events from structured vault facts.
 */

const METRIC_EVENT_MAP = {
  total_sales: { type: "sales", title: "Sales recorded" },
  net_sales: { type: "sales", title: "Net sales recorded" },
  guest_count: { type: "sales", title: "Guest count recorded" },
  complaints: { type: "complaint", title: "Guest complaint logged", severity: "warning" },
  operational_issues: { type: "operational_issue", title: "Operational issue logged", severity: "warning" },
  staff_performance_notes: { type: "staffing", title: "Staff performance note" },
  reservations: { type: "reservation", title: "Reservations recorded" },
  walkins: { type: "reservation", title: "Walk-ins recorded" },
  no_shows: { type: "incident", title: "No-shows recorded", severity: "warning" },
  cancellations: { type: "incident", title: "Cancellations recorded", severity: "info" },
  google_review_5: { type: "review", title: "5-star Google review" },
  google_review_4: { type: "review", title: "4-star Google review" },
  google_review_3: { type: "review", title: "3-star Google review" },
  google_review_2: { type: "review", title: "2-star Google review", severity: "warning" },
  google_review_1: { type: "review", title: "1-star Google review", severity: "critical" },
  discounts: { type: "cash_up", title: "Discounts recorded" },
  voids: { type: "cash_up", title: "Voids recorded", severity: "warning" },
  revenue: { type: "pnl", title: "P&L revenue" },
  cogs: { type: "pnl", title: "P&L COGS" },
  labor: { type: "pnl", title: "P&L labor cost" },
  profit: { type: "pnl", title: "P&L profit" },
  margin: { type: "pnl", title: "P&L margin" },
  weekly_trend: { type: "weekly_summary", title: "Weekly trend noted" },
  variance: { type: "weekly_summary", title: "Weekly variance noted", severity: "warning" },
  action_item: { type: "action_item", title: "Action item recorded" },
  audit_finding: { type: "audit", title: "Audit finding", severity: "warning" },
  promotion: { type: "promotion", title: "Promotion noted" },
};

const TEXT_METRICS = new Set([
  "complaints",
  "operational_issues",
  "staff_performance_notes",
  "operational_highlights",
  "shift_summary",
  "weekly_trend",
  "action_item",
  "audit_finding",
]);

function eventDateFromFact(fact) {
  return fact.period_start || fact.period_end || null;
}

function buildEventFromFact(fact, fileRecord = {}) {
  const mapping = METRIC_EVENT_MAP[fact.metric_key];
  if (!mapping) return null;

  const branchId = fact.branch_id || fileRecord.primary_branch_id;
  const eventDate = eventDateFromFact(fact);
  if (!branchId || !eventDate) return null;

  const textValue = fact.dimensions?.text_value;
  let summary = null;
  if (TEXT_METRICS.has(fact.metric_key) && textValue) {
    summary = String(textValue).slice(0, 500);
  } else if (fact.metric_value != null) {
    summary = `${fact.metric_key}: ${fact.metric_value}`;
  }

  return {
    branch_id: branchId,
    event_date: eventDate,
    event_type: mapping.type,
    title: mapping.title,
    summary,
    severity: mapping.severity || "info",
    source_file_id: fact.file_id || fileRecord.id,
    source_fact_id: fact.id || null,
    metric_key: fact.metric_key,
    metric_value: fact.metric_value,
    dimensions: fact.dimensions || {},
    confidence: fact.confidence,
  };
}

export function buildTimelineEventsFromFacts(facts = [], fileRecord = {}) {
  const events = [];
  for (const fact of facts) {
    const event = buildEventFromFact(fact, fileRecord);
    if (event) events.push(event);
  }
  return events;
}

export async function persistTimelineEvents(supabase, events = []) {
  if (!supabase || !events.length) return { inserted: 0, error: null };

  const { error } = await supabase.from("ask_nac_operational_timeline_events").upsert(events, {
    onConflict: "branch_id,event_date,event_type,source_file_id,metric_key",
    ignoreDuplicates: false,
  });

  return { inserted: events.length, error: error?.message || null };
}

export async function rebuildTimelineForFile(supabase, { fileRecord, facts = [] }) {
  const events = buildTimelineEventsFromFacts(facts, fileRecord);
  return persistTimelineEvents(supabase, events);
}

export async function queryBranchTimeline(
  supabase,
  { branchId, startDate, endDate, eventTypes = null, limit = 100 } = {},
) {
  if (!supabase || !branchId) return [];

  let query = supabase
    .from("ask_nac_operational_timeline_events")
    .select("*")
    .eq("branch_id", branchId)
    .order("event_date", { ascending: false })
    .limit(limit);

  if (startDate) query = query.gte("event_date", startDate);
  if (endDate) query = query.lte("event_date", endDate);
  if (eventTypes?.length) query = query.in("event_type", eventTypes);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}
