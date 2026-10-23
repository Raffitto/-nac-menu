import fs from "fs";
import path from "path";
import { processAskNacQuestion } from "../askNacOrchestrator";
import { serverOperationalAnswerNeedsStructuredRetry } from "../askNacClient";

const OCTOBER_QUESTION = "What guest complaints occurred in Khobar between October 1 and October 14, 2026? Include dates, details, and sources.";

const FACTS = [
  fact("2026-10-01", "breakfast_notes", "Guest complained about cold eggs. Kitchen remade the dish.", "historical_docx_recovery"),
  fact("2026-10-02", "lunch_notes", "Pest control repaired the fly trap.", "historical_docx_recovery"),
  fact("2026-10-03", "dinner_notes", "Guest complained that service was slow and the server was rude.", "historical_docx_recovery"),
  fact("2026-10-08", "dinner_notes", "Guest complained about late food.", "historical_docx_recovery"),
  fact("2026-10-10", "breakfast_notes", "Guest complained about cold eggs.", "historical_docx_recovery"),
  fact("2026-10-09", "staff_performance_notes", "Server was late for the dinner shift.", "historical_docx_recovery"),
];

function fact(date, metricKey, text, provenance) {
  return {
    fileId: `file-${date}-${metricKey}`,
    fileTitle: `Khobar logbook ${date}`,
    metricKey,
    metricValue: null,
    dimensions: { text_value: text, provenance },
    periodStart: date,
    periodEnd: date,
    confidence: 0.9,
  };
}

function mockSupabase(allFacts = FACTS, { rpcError = null, fromError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (rpcError) return { data: null, error: { message: rpcError } };
      const facts = allFacts.filter((row) => row.periodStart >= args.p_start_date && row.periodStart <= args.p_end_date);
      return {
        data: {
          facts,
          coverage: facts.map((row) => ({
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            readinessStatus: "ready",
            sourceFileId: row.fileId,
            fileTitle: row.fileTitle,
            factCount: 1,
          })),
        },
        error: null,
      };
    },
    from() {
      if (fromError) throw new Error(fromError);
      throw new Error("document or postgrest query was not expected");
    },
  };
}

function sourceNames(response) {
  return (response.sources || []).map((source) => source.name).join(" ");
}

async function ask(question, { facts = FACTS, profile = null, conversationContext = null, rpcError = null, fromError = null } = {}) {
  const supabase = mockSupabase(facts, { rpcError, fromError });
  const response = await processAskNacQuestion({
    question,
    supabase,
    profile,
    filters: { branch: profile?.branchScope || "khobar" },
    conversationContext,
  });
  return { response, supabase };
}

describe("October 1-14 Khobar guest complaints", () => {
  test("retrieves recovered structured narratives and does not claim a false zero", async () => {
    const { response, supabase } = await ask(OCTOBER_QUESTION);
    const call = supabase.calls.find((entry) => entry.name === "get_vault_logbook_month_summary_facts");

    expect(response.intent).toBe("vault_operational_review");
    expect(call.args.p_branch_id).toBe("khobar");
    expect(call.args.p_start_date).toBe("2026-10-01");
    expect(call.args.p_end_date).toBe("2026-10-14");
    expect(call.args.p_metric_keys).toEqual(expect.arrayContaining(["breakfast_notes", "lunch_notes", "dinner_notes"]));
    expect(sourceNames(response)).toMatch(/ask_nac_structured_facts/);
    expect(sourceNames(response)).not.toMatch(/ask_nac_document_chunks/);
    expect(response.directAnswer).toMatch(/2026-10-01/);
    expect(response.directAnswer).toMatch(/cold eggs/i);
    expect(response.directAnswer).toMatch(/Kitchen remade the dish/i);
    expect(response.directAnswer).toMatch(/2026-10-03/);
    expect(response.directAnswer).toMatch(/service was slow/i);
    expect(response.directAnswer).toMatch(/2026-10-08/);
    expect(response.directAnswer).toMatch(/late food/i);
    expect(response.directAnswer).toMatch(/historical_docx_recovery/);
    expect(response.directAnswer).not.toMatch(/fly trap/i);
    expect(response.directAnswer).not.toMatch(/no complaints were recorded|no guest complaints occurred|upload or re-index|re-upload|upload daily logbooks/i);
  });

  test("answers one day from that day's structured narrative", async () => {
    const { response, supabase } = await ask("What guest complaints occurred in Khobar on October 3, 2026?");
    const call = supabase.calls[0];
    expect(call.args.p_start_date).toBe("2026-10-03");
    expect(call.args.p_end_date).toBe("2026-10-03");
    expect(response.directAnswer).toMatch(/service was slow/i);
    expect(response.directAnswer).not.toMatch(/cold eggs/i);
    expect(sourceNames(response)).toMatch(/ask_nac_structured_facts/);
  });

  test("compares two operational windows from structured facts", async () => {
    const { response, supabase } = await ask("Compare October 1-7 vs October 8-14 guest complaints in Khobar");
    const ranges = supabase.calls.map((entry) => `${entry.args.p_start_date}:${entry.args.p_end_date}`);
    expect(ranges).toEqual(expect.arrayContaining(["2026-10-01:2026-10-07", "2026-10-08:2026-10-14"]));
    expect(response.directAnswer).toMatch(/cold eggs/i);
    expect(response.directAnswer).toMatch(/late food/i);
    expect(response.intent).not.toBe("vault_cash_up_summary");
    expect(sourceNames(response)).not.toMatch(/ask_nac_document_chunks/);
  });

  test("identifies recurring complaint wording", async () => {
    const { response } = await ask("What recurring guest complaints occurred in Khobar between October 1 and October 14, 2026?");
    expect(response.directAnswer).toMatch(/recurring/i);
    expect(response.directAnswer).toMatch(/cold eggs/i);
  });

  test("returns maintenance incidents without treating them as guest complaints", async () => {
    const { response } = await ask("What maintenance incidents occurred in Khobar between October 1 and October 14, 2026?");
    expect(response.directAnswer).toMatch(/fly trap/i);
    expect(response.directAnswer).not.toMatch(/cold eggs/i);
    expect(sourceNames(response)).toMatch(/ask_nac_structured_facts/);
  });

  test("returns staff performance notes", async () => {
    const { response } = await ask("How did staff perform in Khobar between October 1 and October 14, 2026?");
    expect(response.directAnswer).toMatch(/Server was late/i);
    expect(response.directAnswer).not.toMatch(/cold eggs/i);
  });

  test("follow-up keeps the date range and filters to food quality", async () => {
    const { response, supabase } = await ask(
      "Which of those complaints involved food quality rather than service?",
      {
        conversationContext: {
          lastQuestion: OCTOBER_QUESTION,
          lastResolvedQuestion: OCTOBER_QUESTION,
          lastIntent: "vault_operational_review",
        },
      },
    );
    expect(supabase.calls[0].args.p_start_date).toBe("2026-10-01");
    expect(supabase.calls[0].args.p_end_date).toBe("2026-10-14");
    expect(response.directAnswer).toMatch(/cold eggs/i);
    expect(response.directAnswer).toMatch(/late food/i);
    expect(response.directAnswer).not.toMatch(/server was rude/i);
    expect(response.directAnswer).not.toMatch(/resolved the complaint|issue was resolved/i);
  });

  test("blocks a Khobar-scoped user from another branch before querying", async () => {
    const { response, supabase } = await ask(
      "What guest complaints occurred in Riyadh between October 1 and October 14, 2026?",
      { profile: { authenticated: true, allBranches: false, branchScope: "khobar" } },
    );
    expect(supabase.calls).toHaveLength(0);
    expect(response.directAnswer).toMatch(/Khobar/i);
    expect(response.directAnswer).toMatch(/cannot query|does not include|scoped/i);
  });

  test("empty structured results are not a verified zero and do not request re-upload", async () => {
    const { response, supabase } = await ask(OCTOBER_QUESTION, { facts: [] });
    expect(supabase.calls[0].args.p_branch_id).toBe("khobar");
    expect(sourceNames(response)).toMatch(/ask_nac_structured_facts/);
    expect(sourceNames(response)).not.toMatch(/ask_nac_document_chunks/);
    expect(response.directAnswer).toMatch(/does not establish/i);
    expect(response.directAnswer).not.toMatch(/no complaints were recorded|no guest complaints occurred|upload or re-index|re-upload/i);
  });

  test("database errors stay distinct from zero complaints", async () => {
    const { response } = await ask(OCTOBER_QUESTION, {
      rpcError: "statement timeout",
      fromError: "postgrest unavailable",
    });
    expect(response.directAnswer).toMatch(/retrieval failed|database error/i);
    expect(response.directAnswer).toMatch(/does not establish/i);
    expect(sourceNames(response)).toMatch(/ask_nac_structured_facts/);
    expect(response.directAnswer).not.toMatch(/no complaints were recorded|upload or re-index|re-upload/i);
  });
});

describe("deployed server false-zero retry", () => {
  test("retries when the server cites document chunks for a dated complaint question", () => {
    expect(serverOperationalAnswerNeedsStructuredRetry(OCTOBER_QUESTION, {
      answerType: "document_no_match",
      directAnswer: "No operational findings matched this review.",
      recommendations: ["Upload or re-index daily logbooks for the period, then retry."],
      sources: [{ name: "ask_nac_document_chunks", detail: "Operational review search" }],
    })).toBe(true);
  });

  test("keeps a server answer that already cites structured facts", () => {
    expect(serverOperationalAnswerNeedsStructuredRetry(OCTOBER_QUESTION, {
      intent: "vault_operational_review",
      directAnswer: "Guest complained about cold eggs.",
      sources: [{ name: "ask_nac_structured_facts", detail: "recovered narratives" }],
    })).toBe(false);
  });
});

describe("edge operational retrieval contract", () => {
  const root = path.resolve(__dirname, "../../../..");
  const query = fs.readFileSync(path.join(root, "supabase/functions/_shared/vaultMonthlyLogbookQuery.ts"), "utf8");
  const tools = fs.readFileSync(path.join(root, "supabase/functions/_shared/askNacVaultTools.ts"), "utf8");
  const summary = fs.readFileSync(path.join(root, "supabase/functions/_shared/vaultMonthlyLogbookSummary.ts"), "utf8");

  test("date ranges are not rejected before structured retrieval", () => {
    expect(query).not.toMatch(/if\s*\(\s*!vaultPeriod\?\.isMonth\s*\)\s*return null/);
    expect(tools).toMatch(/requiresStructuredOperationalRetrieval/);
    expect(summary).not.toMatch(/Upload or re-index daily logbooks/);
  });
});
