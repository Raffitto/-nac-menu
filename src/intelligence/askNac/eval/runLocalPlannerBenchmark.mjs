/**
 * Local planner benchmark harness via ModelGateway OpenAI-compatible adapter.
 * This run uses an in-process mock local endpoint (NO model weights downloaded).
 *
 * Decision (11 Aug 2026, M2 Max 32GB, disk ~94% / 55GB free):
 * - mlx-lm / ollama not installed
 * - no OPENAI_API_KEY available for cloud baseline
 * - GPT-OSS 20B (~12GB) / Qwen3-30B-A3B-4bit (~17GB) rejected for this phase
 *   due to disk pressure + missing Apple Silicon runtime + Cursor headroom
 *
 * Usage: node src/intelligence/askNac/eval/runLocalPlannerBenchmark.mjs
 */
import { createServer } from "http";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";

globalThis.Deno = {
  env: {
    get: (k) => {
      if (k === "MODEL_GATEWAY_FAST_PROVIDER") return "openai_compatible_local";
      if (k === "MODEL_GATEWAY_REASON_PROVIDER") return "openai_compatible_local";
      if (k === "MODEL_GATEWAY_SYNTHESIZE_PROVIDER") return "openai_compatible_local";
      if (k === "MODEL_GATEWAY_CLOUD_ENABLED") return "false";
      if (k === "MODEL_GATEWAY_LOCAL_BASE_URL") return process.env.MODEL_GATEWAY_LOCAL_BASE_URL;
      if (k === "MODEL_GATEWAY_LOCAL_MODEL") return "mock-local-planner";
      if (k === "ASK_NAC_PLANNER_MODE") return "heuristic";
      return undefined;
    },
  },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../../..");
const fabric = await import(join(root, "supabase/functions/_shared/companyIntelligence/index.ts"));

const QUESTIONS = [
  "How's business been lately?",
  "Are we doing better than the week before?",
  "Why was last week shit?",
  "Anything I need to act on right now?",
  "If Ahmed asks how we're doing, what do I tell him?",
  "Where are we losing money?",
  "What went wrong operationally this week?",
  "Compare last year's Ramadan sales with this year's for Khobar.",
  "How was July?",
  "Give me the top 3 and bottom 3 days this month.",
];

function mockPlan(question) {
  const q = question.toLowerCase();
  if (q.includes("ramadan")) {
    return {
      intent: "period_compare",
      capabilities: ["calendar.resolve_period", "company.branch_timeline", "commercial.compare"],
      metric_family: "commercial",
      scope: { branch: "khobar" },
      time: { expression: "ramadan_yoy" },
      comparison: { requested: true, type: "previous_equivalent_period" },
      needs_clarification: false,
      operations: [{ tool: "cash_up_compare", purpose: "compare" }],
    };
  }
  if (q.includes("losing money") || q.includes("margin")) {
    return {
      intent: "cost_margin",
      capabilities: ["cost.margin_analysis", "commercial.performance"],
      metric_family: "cost",
      scope: { branch: "khobar" },
      time: { expression: "this_month" },
      comparison: { requested: false, type: null },
      needs_clarification: false,
      operations: [{ tool: "cash_up_performance", purpose: "sales context" }],
    };
  }
  if (q.includes("operational")) {
    return {
      intent: "operational_review",
      capabilities: ["operations.review"],
      metric_family: "operational",
      scope: { branch: "khobar" },
      time: { expression: "this_week" },
      comparison: { requested: false, type: null },
      needs_clarification: false,
      operations: [{ tool: "operational_evidence", purpose: "ops" }],
    };
  }
  if (q.includes("shit") || q.includes("why")) {
    return {
      intent: "issue_detection",
      capabilities: ["commercial.performance", "commercial.compare", "operations.review"],
      metric_family: "mixed",
      scope: { branch: "khobar" },
      time: { expression: "last_week" },
      comparison: { requested: true, type: "previous_equivalent_period" },
      needs_clarification: false,
      operations: [
        { tool: "cash_up_compare", purpose: "compare" },
        { tool: "operational_evidence", purpose: "ops", optional: true },
      ],
    };
  }
  return {
    intent: "performance_overview",
    capabilities: ["commercial.performance", "commercial.compare"],
    metric_family: "commercial",
    scope: { branch: "khobar" },
    time: { expression: "last_14_days" },
    comparison: { requested: true, type: "previous_equivalent_period" },
    needs_clarification: false,
    operations: [{ tool: "cash_up_performance", purpose: "overview" }],
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    let question = "";
    try {
      const parsed = JSON.parse(body);
      const user = parsed.messages?.find((m) => m.role === "user")?.content || "";
      const maybe = JSON.parse(user);
      question = maybe.question || user;
    } catch {
      question = body.slice(0, 200);
    }
    const plan = mockPlan(question);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(plan) } }],
      usage: { prompt_tokens: 120, completion_tokens: 80 },
      model: "mock-local-planner",
    }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
process.env.MODEL_GATEWAY_LOCAL_BASE_URL = `http://127.0.0.1:${port}/v1`;

const gateway = fabric.createModelGateway(
  {
    openai_compatible_local: fabric.createOpenAiCompatibleLocalAdapter({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "mock-local-planner",
    }),
  },
  {
    ...fabric.loadModelGatewayConfig(),
    fastProvider: "openai_compatible_local",
    reasonProvider: "openai_compatible_local",
    synthesizeProvider: "openai_compatible_local",
    cloudEnabled: false,
    maxPaidCallsPerAnswer: 0,
    localBaseUrl: `http://127.0.0.1:${port}/v1`,
    localModel: "mock-local-planner",
  },
);

const rows = [];
for (const question of QUESTIONS) {
  const started = Date.now();
  const planRes = await gateway.plan({
    system: "Return JSON management plan only.",
    user: JSON.stringify({ question }),
    json: true,
  });
  let schemaValid = false;
  let capabilities = [];
  try {
    const parsed = JSON.parse(planRes.content || "{}");
    schemaValid = Array.isArray(parsed.capabilities) && typeof parsed.intent === "string";
    capabilities = parsed.capabilities || [];
  } catch {
    schemaValid = false;
  }

  const orch = await fabric.runCompanyIntelligenceOrchestration({
    question,
    branchHint: "khobar",
    referenceDate: new Date("2026-08-10T12:00:00+03:00"),
    mode: "heuristic",
    gateway,
  });

  rows.push({
    question,
    localPlanOk: planRes.ok,
    schemaValid,
    capabilities,
    paid: orch.paidModelCalls,
    feasibility: orch.state.feasibility?.status || null,
    tools: orch.toolsExecuted,
    latencyMs: Date.now() - started,
    provider: planRes.provider,
  });
}

server.close();

const summary = {
  runtime: "mock-openai-compatible-local (no weights downloaded)",
  candidateSelected: null,
  downloadSkippedReason: [
    "disk ~94% full (~55GB free)",
    "mlx-lm not installed",
    "ollama not installed",
    "GPT-OSS 20B / Qwen3-30B-A3B downloads (12–17GB) unjustified without runtime",
  ],
  total: rows.length,
  localPlanOk: rows.filter((r) => r.localPlanOk).length,
  schemaValid: rows.filter((r) => r.schemaValid).length,
  zeroPaid: rows.filter((r) => r.paid === 0).length,
  avgLatencyMs: Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length),
  ramObservedGb: null,
};

writeFileSync("/tmp/local-planner-benchmark.json", JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
