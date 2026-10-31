import { processAskNacQuestion } from "../askNacOrchestrator";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";

const COMPLAINTS = "What guest complaints occurred in Khobar between October 1 and October 14, 2026? Include dates, details, management actions, and sources.";

function fact(date, section, text) {
  return {
    fileId: `file-${date}-${section}`,
    fileTitle: `Khobar logbook ${date}`,
    metricKey: section,
    dimensions: { text_value: text, provenance: "historical_docx_recovery" },
    periodStart: date,
    periodEnd: date,
  };
}

const FACTS = [
  fact("2026-10-01", "dinner_notes", "Table 21 complained about quinoa salad tasting different. Management tasted it, offered another salad, and removed the original item from the bill. No other drinks complaints. Table 10 became upset about the popcorn chicken service sequence. Staff offered popcorn chicken as recovery."),
  fact("2026-10-07", "dinner_notes", "Table 21 complained about Black Angus steak taste and spicy sauce. A replacement was offered and refused. The steak was removed from the bill."),
  fact("2026-10-08", "lunch_notes", "Lunch was busy. A guest complained that service was slow."),
  fact("2026-10-09", "operational_issues", "The ice cream machine was replaced during the afternoon."),
  fact("2026-10-11", "operational_issues", "Minor maintenance on the dishwasher was completed."),
  fact("2026-10-12", "dinner_notes", "Service was steady. No guest complained. Pest control checked the dining room traps afterwards."),
  fact("2026-10-13", "dinner_notes", "Table 10 complained about French toast tasting different. Another dessert was offered and refused. The item was removed from the bill."),
  fact("2026-10-04", "staff_performance_notes", "Server was late for the dinner shift and the section opened short."),
];

function mockSupabase(rows = FACTS) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      const facts = rows.filter((row) => row.periodStart >= args.p_start_date && row.periodStart <= args.p_end_date);
      return { data: { facts, coverage: [] }, error: null };
    },
    from() {
      return { select: () => ({ data: [], error: null }) };
    },
  };
}

async function ask(question, { context = null, rows = FACTS } = {}) {
  const supabase = mockSupabase(rows);
  const response = await processAskNacQuestion({
    question,
    supabase,
    filters: { branch: "khobar" },
    conversationContext: context,
  });
  return { response, supabase };
}

describe("Ask NAC acceptance gate", () => {
  test("case 1 lists separate complaints and drops the negated 12 October line", async () => {
    const { response, supabase } = await ask(COMPLAINTS);
    expect(response.intent).toBe(ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW);
    expect(supabase.calls[0].args.p_start_date).toBe("2026-10-01");
    expect(supabase.calls[0].args.p_end_date).toBe("2026-10-14");
    expect(response.directAnswer).toMatch(/Quinoa Salad/i);
    expect(response.directAnswer).toMatch(/Popcorn Chicken/i);
    expect(response.directAnswer).toMatch(/Black Angus Steak/i);
    expect(response.directAnswer).toMatch(/French Toast/i);
    expect(response.directAnswer).not.toMatch(/No guest complained/i);
    expect(response.directAnswer).not.toMatch(/pest control/i);
    expect(response.operationalFindings.filter((item) => item.kind === "complaint").length).toBeGreaterThanOrEqual(4);
    expect(response.directAnswer).toMatch(/not documented/i);
    expect(response.directAnswer).toMatch(/historical_docx_recovery/);
  });

  test("case 2 resolution follow-up keeps the October window", async () => {
    const first = await ask(COMPLAINTS);
    const { response, supabase } = await ask("Which of those complaints were resolved, and which still require follow-up?", {
      context: first.response.nextContext,
    });
    expect(supabase.calls[0].args.p_start_date).toBe("2026-10-01");
    expect(supabase.calls[0].args.p_end_date).toBe("2026-10-14");
    expect(response.directAnswer).toMatch(/follow-up|not documented/i);
    expect(response.directAnswer).not.toMatch(/could not parse a calendar|vault period missing/i);
    expect(response.directAnswer).not.toMatch(/Outcome: Guest satisfaction recorded/i);
  });

  test("case 3 food-quality follow-up keeps the dates and excludes service", async () => {
    const first = await ask(COMPLAINTS);
    const { response, supabase } = await ask("Which of those complaints involved food quality rather than service?", {
      context: first.response.nextContext,
    });
    expect(supabase.calls[0].args.p_end_date).toBe("2026-10-14");
    expect(response.directAnswer).toMatch(/French Toast|Quinoa Salad|Black Angus/i);
    expect(response.directAnswer).not.toMatch(/Popcorn Chicken/i);
    expect(response.directAnswer).not.toMatch(/could not parse a calendar/i);
  });

  test("case 4 recurring analysis sees more than the last day", async () => {
    const { response } = await ask("Were there any recurring guest complaints in Khobar between October 1 and October 14, 2026?");
    expect(response.directAnswer).toMatch(/Quinoa Salad|Black Angus/i);
    expect(response.directAnswer).toMatch(/French Toast/i);
    expect((response.operationalFindings || []).length).toBeGreaterThan(1);
  });

  test("case 5 maintenance does not use guest satisfaction or one fake recurring failure", async () => {
    const { response } = await ask("What maintenance, pest-control, or equipment issues were recorded in Khobar between October 1 and October 14, 2026?");
    expect(response.directAnswer).toMatch(/ice cream machine/i);
    expect(response.directAnswer).toMatch(/pest control/i);
    expect(response.directAnswer).not.toMatch(/guest satisfaction|Final satisfaction not documented/i);
    expect(response.directAnswer).not.toMatch(/recurring/i);
  });

  test("case 6 staff issues stay off the sales total", async () => {
    const route = routeAskNacIntent("What staff performance issues were documented in Khobar between October 1 and October 14, 2026? Include dates and evidence.");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW);
    const { response } = await ask("What staff performance issues were documented in Khobar between October 1 and October 14, 2026? Include dates and evidence.");
    expect(response.directAnswer).toMatch(/Server was late/i);
    expect(response.directAnswer).not.toMatch(/212,326|total sales/i);
  });

  test("case 7 compares both explicit days", async () => {
    const { response, supabase } = await ask("Compare Khobar's operational issues on October 1 and October 8, 2026. What happened on each day?");
    const ranges = supabase.calls.map((call) => `${call.args.p_start_date}:${call.args.p_end_date}`);
    expect(ranges.join(" ")).toMatch(/2026-10-01/);
    expect(ranges.join(" ")).toMatch(/2026-10-08/);
    expect(response.directAnswer).toMatch(/2026-10-01|1 October/);
    expect(response.directAnswer).toMatch(/2026-10-08|8 October/);
  });

  test("case 8 gives evidence-backed priorities without claiming the logbooks are missing", async () => {
    const { response } = await ask("Based on Khobar's October 1–14 logbooks, what are the three most important operational improvements management should prioritize, and why?");
    expect(response.directAnswer).toMatch(/Priorities supported/i);
    expect(response.directAnswer).not.toMatch(/upload or re-index|records were incomplete|re-upload/i);
    expect(response.directAnswer).toMatch(/1\./);
  });

  test("case 9 sales comparison stays on cash-up rather than complaints", () => {
    const route = routeAskNacIntent("Compare Khobar's total sales for October 1-7 versus October 8-14, 2026. Include revenue, percentage difference, and sources.");
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.TOP_ITEMS);
    expect(String(route.intent)).toMatch(/cash_up|sales/);
  });

  test("case 10 menu quantity ranking is not the highest sales day", () => {
    const route = routeAskNacIntent("What were Khobar's five best-selling menu items by quantity between October 1 and October 14, 2026?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.TOP_ITEMS);
    expect(route.rankingBasis).toBe("quantity");
  });

  test("case 11 names both the complaint register and the product-ranking result", async () => {
    const { response } = await ask("Did any documented guest complaints between October 1 and October 14 involve products that were also among Khobar's best sellers during that period?");
    expect(response.directAnswer).toMatch(/Quinoa Salad|French Toast|Black Angus/i);
    expect(response.directAnswer).toMatch(/quantity ranking|best sellers|Item-level/i);
    expect(response.directAnswer).not.toMatch(/highest sales day/i);
  });

  test("case 12 executive summary is not an empty service-only answer", async () => {
    const { response } = await ask("Prepare an executive operational summary for NAC Khobar covering October 1–14, 2026, including guest complaints, service issues, maintenance, management actions, and recommended priorities.");
    expect(response.intent).toBe(ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW);
    expect(response.operationalFindings.length).toBeGreaterThan(0);
    expect(response.directAnswer).toMatch(/Quinoa Salad|French Toast|ice cream|pest/i);
    expect(response.directAnswer).toMatch(/Priorities supported/i);
  });
});
