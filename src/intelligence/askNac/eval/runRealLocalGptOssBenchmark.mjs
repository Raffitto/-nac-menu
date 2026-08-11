/**
 * REAL local gpt-oss:20b planner/synthesis benchmark via Company Intelligence Fabric.
 * Ollama OpenAI-compatible endpoint only. No cloud. No model weights committed.
 *
 * Usage:
 *   MODEL_GATEWAY_CLOUD_ENABLED=false \
 *   MODEL_GATEWAY_FAST_PROVIDER=openai_compatible_local \
 *   MODEL_GATEWAY_REASON_PROVIDER=openai_compatible_local \
 *   MODEL_GATEWAY_SYNTHESIZE_PROVIDER=openai_compatible_local \
 *   MODEL_GATEWAY_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 \
 *   MODEL_GATEWAY_LOCAL_MODEL=gpt-oss:20b \
 *   node src/intelligence/askNac/eval/runRealLocalGptOssBenchmark.mjs
 */
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const ENV = {
  MODEL_GATEWAY_CLOUD_ENABLED: "false",
  MODEL_GATEWAY_FAST_PROVIDER: "openai_compatible_local",
  MODEL_GATEWAY_REASON_PROVIDER: "openai_compatible_local",
  MODEL_GATEWAY_SYNTHESIZE_PROVIDER: "openai_compatible_local",
  MODEL_GATEWAY_LOCAL_BASE_URL: process.env.MODEL_GATEWAY_LOCAL_BASE_URL || "http://127.0.0.1:11434/v1",
  MODEL_GATEWAY_LOCAL_MODEL: process.env.MODEL_GATEWAY_LOCAL_MODEL || "gpt-oss:20b",
  MODEL_GATEWAY_LOCAL_MAX_TOKENS: process.env.MODEL_GATEWAY_LOCAL_MAX_TOKENS || "1600",
  MODEL_GATEWAY_MAX_PAID_CALLS: "0",
  ASK_NAC_PLANNER_MODE: "auto",
};

globalThis.Deno = {
  env: {
    get: (k) => (k in ENV ? ENV[k] : process.env[k]),
  },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../../..");
const fabric = await import(join(root, "supabase/functions/_shared/companyIntelligence/index.ts"));

const REF = new Date("2026-08-10T12:00:00+03:00");
const QUESTIONS = [
  "How's business been lately?",
  "Are we doing better than the week before?",
  "Why was last week shit?",
  "Anything I need to act on right now?",
  "If Ahmed asks how we're doing, what do I tell him?",
  "Where are we losing money?",
  "What went wrong operationally this week?",
  "Compare July with June.",
  "Is Khobar doing better than Riyadh?",
  "Compare last year's Ramadan sales with this year's for Khobar.",
];

function memSnapshot() {
  try {
    const rss = execSync("ps -axo rss,comm", { encoding: "utf8" })
      .split("\n")
      .filter((l) => /ollama|llama-server/i.test(l))
      .reduce((s, l) => s + (Number(String(l).trim().split(/\s+/)[0]) || 0), 0);
    let pressure = null;
    try {
      pressure = execSync("memory_pressure", { encoding: "utf8" }).split("\n").slice(0, 10).join("\n");
    } catch {
      pressure = null;
    }
    return { ollamaRssMb: Math.round(rss / 1024), pressureHead: pressure };
  } catch {
    return { ollamaRssMb: null, pressureHead: null };
  }
}

function scoreRow(question, orch) {
  const q = question.toLowerCase();
  const intent = orch.state.plan?.goal || null;
  const caps = orch.state.plan?.capabilities || [];
  const branch = orch.state.scope?.primaryBranchId || null;
  const localPlanner = orch.state.cost?.modelProvider === "openai_compatible_local";
  const feasibility = orch.state.feasibility?.status || null;
  const paid = orch.paidModelCalls;
  const fallback = Boolean(orch.state.cost?.cloudEscalationReason);
  // Ramadan short-circuits before planner — schema N/A, count as valid deterministic path
  const schemaValid = feasibility === "NOT_ANSWERABLE_AS_REQUESTED" || (localPlanner && !fallback);

  let grade = "PASS";
  const notes = [];

  if (feasibility !== "NOT_ANSWERABLE_AS_REQUESTED" && (!localPlanner || fallback)) {
    grade = "FAIL";
    notes.push("planner_fallback_or_invalid_schema");
  }

  if (q.includes("ramadan")) {
    if (feasibility !== "NOT_ANSWERABLE_AS_REQUESTED") {
      grade = "HIGH-SEVERITY";
      notes.push("ramadan_should_be_infeasible");
    } else if (orch.toolsExecuted.some((t) => /cash_up|sales|compare/i.test(t))) {
      grade = "HIGH-SEVERITY";
      notes.push("ramadan_ran_sales_tools");
    } else {
      grade = "PASS";
      notes.push("feasibility_blocked_correctly");
    }
  } else if (q.includes("losing money")) {
    if (intent === "cost_margin" || caps.includes("cost.margin_analysis")) {
      grade = "ACCEPTABLE";
      notes.push("cost_capability_selected_deterministic_gate_must_handle");
    } else if (intent === "unsupported" || orch.state.plan?.needsClarification) {
      grade = "PASS";
      notes.push("cost_unsupported_or_clarify");
    } else {
      grade = "FAIL";
      notes.push("missed_cost_intent");
    }
  } else if (q.includes("operational")) {
    if (!caps.includes("operations.review") && intent !== "operational_review") {
      grade = "FAIL";
      notes.push("missed_ops");
    }
  } else if (q.includes("riyadh") || q.includes("khobar doing better")) {
    if (!caps.includes("company.scope_compare") && intent !== "branch_compare") {
      grade = grade === "PASS" ? "ACCEPTABLE" : grade;
      notes.push("branch_compare_weak");
    }
  } else if (q.includes("july") && q.includes("june")) {
    if (!caps.includes("commercial.compare") && intent !== "period_compare") {
      grade = "FAIL";
      notes.push("missed_compare");
    }
  } else if (q.includes("shit") || q.includes("why was last week")) {
    if (!caps.some((c) => /compare|performance|operations/.test(c))) {
      grade = "FAIL";
      notes.push("missed_issue_detection");
    }
  } else if (q.includes("lately") || q.includes("ahmed") || q.includes("act on") || q.includes("week before")) {
    if (!caps.some((c) => /commercial/.test(c)) && intent === "unsupported") {
      grade = "HIGH-SEVERITY";
      notes.push("failed_management_intent");
    } else if (!localPlanner || fallback) {
      grade = "FAIL";
    }
  }

  if (paid > 0) {
    grade = "HIGH-SEVERITY";
    notes.push("paid_calls_nonzero");
  }

  // Wrong branch hard fail if model invents non-khobar without question asking
  if (branch && !["khobar", "riyadh", "jeddah", null].includes(branch)) {
    grade = "HIGH-SEVERITY";
    notes.push("invalid_branch");
  }
  if (q.includes("riyadh") && branch === "khobar" && !q.includes("khobar")) {
    // question asks khobar vs riyadh — khobar hint ok
  }

  return {
    grade,
    notes,
    intent,
    caps,
    branch,
    schemaValid: Boolean(schemaValid),
    fallback,
    feasibility,
    paid,
    clarification: Boolean(orch.state.plan?.needsClarification),
  };
}

const gateway = fabric.createModelGateway(undefined, {
  ...fabric.loadModelGatewayConfig(),
  fastProvider: "openai_compatible_local",
  reasonProvider: "openai_compatible_local",
  synthesizeProvider: "openai_compatible_local",
  cloudEnabled: false,
  maxPaidCallsPerAnswer: 0,
  localBaseUrl: ENV.MODEL_GATEWAY_LOCAL_BASE_URL,
  localModel: ENV.MODEL_GATEWAY_LOCAL_MODEL,
});

console.log(JSON.stringify({
  phase: "start",
  endpoint: ENV.MODEL_GATEWAY_LOCAL_BASE_URL,
  model: ENV.MODEL_GATEWAY_LOCAL_MODEL,
  mem: memSnapshot(),
}, null, 2));

// Sanity
const sanityStart = Date.now();
const sanity = await gateway.plan({
  system: "Return JSON only. No markdown.",
  user: 'Return valid JSON with {"status":"ok"}.',
  json: true,
  maxTokens: 512,
});
let sanityParsed = null;
try {
  sanityParsed = JSON.parse(sanity.content || "");
} catch {
  sanityParsed = null;
}
const sanityResult = {
  ok: sanity.ok && sanityParsed?.status === "ok",
  latencyMs: Date.now() - sanityStart,
  provider: sanity.provider,
  model: sanity.model,
  usage: sanity.usage,
  content: sanity.content,
  error: sanity.error || null,
};
console.log(JSON.stringify({ phase: "sanity", ...sanityResult }, null, 2));
if (!sanityResult.ok) {
  writeFileSync("/tmp/gptoss-real-benchmark.json", JSON.stringify({ stopped: "sanity_failed", sanityResult }, null, 2));
  console.error("STOP: structured JSON sanity failed");
  process.exit(2);
}

const rows = [];
for (const question of QUESTIONS) {
  const started = Date.now();
  const memBefore = memSnapshot();
  const orch = await fabric.runCompanyIntelligenceOrchestration({
    question,
    branchHint: "khobar",
    referenceDate: REF,
    mode: "auto",
    gateway,
    maxPaidCalls: 0,
  });
  const latencyMs = Date.now() - started;
  const memAfter = memSnapshot();
  const scored = scoreRow(question, orch);
  const row = {
    question,
    ...scored,
    plannerSource: orch.state.cost?.modelProvider || null,
    fallbackReason: orch.state.cost?.cloudEscalationReason || null,
    tools: orch.toolsExecuted,
    answerHead: String(orch.answerText || "").slice(0, 220),
    periods: {
      current: orch.state.periods?.current || null,
      comparison: orch.state.periods?.comparison || null,
    },
    latencyMs,
    promptTokens: orch.state.cost?.promptTokens || null,
    completionTokens: orch.state.cost?.completionTokens || null,
    memBeforeMb: memBefore.ollamaRssMb,
    memAfterMb: memAfter.ollamaRssMb,
  };
  rows.push(row);
  console.log(JSON.stringify({ phase: "planner_row", n: rows.length, grade: row.grade, latencyMs, intent: row.intent, fallback: row.fallback }, null, 2));
}

// Synthesis sample with normalized evidence only
const synthEvidence = {
  question: "How was July?",
  scope: { primaryBranchId: "khobar", branchIds: ["khobar"] },
  periods: { current: { startDate: "2026-07-01", endDate: "2026-07-31", label: "July 2026" } },
  claims: [
    { type: "VERIFIED_FACT", text: "July net sales were 1,250,000 SAR", metric: "net_sales", value: 1250000 },
    { type: "VERIFIED_FACT", text: "July covers were 18,400", metric: "covers", value: 18400 },
  ],
  evidence: [
    {
      id: "e1",
      source: "cash_up",
      authority: "primary",
      metric: "net_sales",
      value: 1250000,
      summary: "July net sales 1,250,000 SAR",
      period: { startDate: "2026-07-01", endDate: "2026-07-31" },
    },
  ],
  warnings: ["coverage_complete"],
};
const synStart = Date.now();
const syn = await gateway.synthesize({
  system: [
    "You are Ask NAC. Write a concise manager answer from verified evidence only.",
    'Return JSON only: {"directAnswer":"..."}.',
    "Do not invent numbers, dates, branches, causes, or margins.",
    "Do not mention tools, SQL, or internal labels.",
  ].join(" "),
  user: JSON.stringify(synthEvidence),
  json: true,
  maxTokens: 1600,
});
let synAnswer = null;
let synParseOk = false;
try {
  synAnswer = JSON.parse(syn.content || "").directAnswer || JSON.parse(syn.content || "").answer || null;
  synParseOk = Boolean(synAnswer);
} catch {
  synParseOk = false;
}
const synthEval = {
  ok: syn.ok && synParseOk,
  latencyMs: Date.now() - synStart,
  usage: syn.usage,
  answer: synAnswer,
  inventsMargin: /margin|food.?cost|%\s*gp/i.test(String(synAnswer || "")),
  inventsCause: /\bbecause\b|\bdue to\b|\bcaused by\b/i.test(String(synAnswer || "")),
  mentionsDebug: /tool|sql|capability|evidence ledger/i.test(String(synAnswer || "")),
  citesJulyNumber: /1[,.]?250[,.]?000|1250000/.test(String(synAnswer || "")),
};

// Multi-turn
let conversation = null;
const turns = ["How was July?", "And June?", "Why the difference?", "What about weekends only?"];
const multi = [];
for (const question of turns) {
  const r = await fabric.runCompanyIntelligenceOrchestration({
    question,
    branchHint: "khobar",
    referenceDate: REF,
    mode: "auto",
    gateway,
    conversation,
    maxPaidCalls: 0,
  });
  conversation = r.nextConversation;
  multi.push({
    question,
    branch: r.state.scope?.primaryBranchId,
    current: r.state.periods?.current || null,
    comparison: r.state.periods?.comparison || null,
    goal: r.state.plan?.goal,
    caps: r.state.plan?.capabilities,
    schemaPlannerLocal: r.state.cost?.modelProvider === "openai_compatible_local",
    fallback: r.state.cost?.cloudEscalationReason || null,
    answerHead: String(r.answerText || "").slice(0, 180),
  });
}

const grades = rows.reduce((acc, r) => {
  acc[r.grade] = (acc[r.grade] || 0) + 1;
  return acc;
}, {});
const schemaValidRate = rows.filter((r) => r.schemaValid).length / rows.length;
const fallbackRate = rows.filter((r) => r.fallback).length / rows.length;
const avgLatency = Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length);
const tokenRows = rows.filter((r) => r.completionTokens);
const approxTps = tokenRows.length
  ? Number((tokenRows.reduce((s, r) => s + (r.completionTokens || 0), 0)
    / (tokenRows.reduce((s, r) => s + r.latencyMs, 0) / 1000)).toFixed(2))
  : null;

const report = {
  runtime: "ollama",
  modelId: "gpt-oss:20b",
  endpoint: ENV.MODEL_GATEWAY_LOCAL_BASE_URL,
  cloudEnabled: false,
  paidApiCalls: rows.reduce((s, r) => s + r.paid, 0),
  sanity: sanityResult,
  grades,
  schemaValidRate,
  fallbackRate,
  avgPlannerLatencyMs: avgLatency,
  approxTokensPerSec: approxTps,
  mem: memSnapshot(),
  rows,
  synthesis: synthEval,
  multiTurn: multi,
};

writeFileSync("/tmp/gptoss-real-benchmark.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  phase: "summary",
  grades,
  schemaValidRate,
  fallbackRate,
  avgPlannerLatencyMs: avgLatency,
  approxTokensPerSec: approxTps,
  synthesisOk: synthEval.ok,
  multiTurnBranches: multi.map((m) => m.branch),
  mem: report.mem,
}, null, 2));
