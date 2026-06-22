/**
 * Edge parity verifier — local routing + optional production Ask NAC checks.
 *
 * Run:
 *   node tmp-vault-verify/edge-parity-verify.mjs
 *   node tmp-vault-verify/edge-parity-verify.mjs --prod
 *
 * Local mode tests Edge orchestrator routing only (no auth).
 * Production mode POSTs to ask-nac (requires ASK_NAC_ACCESS_TOKEN or magic-link env).
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const ORCHESTRATOR_PATH = path.join(REPO_ROOT, "supabase/functions/_shared/askNacOrchestrator.ts");

const LOCAL_ROUTING_CASES = [
  {
    label: "sales yesterday",
    question: "sales yesterday",
    expectIntent: "vault_cash_up_summary",
    forbidIntent: "sales_total",
  },
  {
    label: "delivery apps this year",
    question: "delivery apps this year",
    expectIntent: "vault_cash_up_summary",
    forbidIntent: "delivery_sales",
  },
  {
    label: "show latest cash up",
    question: "show latest cash up",
    expectIntent: "vault_cash_up_summary",
  },
  {
    label: "why were sales down yesterday",
    question: "why were sales down yesterday",
    expectIntent: "vault_business_reasoning",
    forbidIntent: "sales_total",
  },
];

const PROD_CASES = [
  {
    label: "show latest cash up",
    question: "show latest cash up",
    assert(answer) {
      if (!/cash|sales performance/i.test(answer.title || "")) throw new Error("expected cash-up title");
      if (answer.confidence === "none") throw new Error("expected confidence above none");
    },
  },
  {
    label: "sales yesterday",
    question: "sales yesterday",
    assert(answer) {
      if (/foodics/i.test(answer.title || "") || /foodics/i.test(answer.directAnswer || "")) {
        throw new Error("routed to Foodics aggregate");
      }
      if (/2026-06-01.*2026-06-19/i.test(answer.directAnswer || "")) {
        throw new Error("returned MTD Foodics range instead of single-day vault");
      }
      if (answer.intent === "sales_total") throw new Error("intent still sales_total");
      if (!/yesterday|single|net sales|total sales/i.test(`${answer.title} ${answer.directAnswer}`)) {
        throw new Error("missing yesterday/single-day sales label");
      }
    },
  },
  {
    label: "delivery apps this year",
    question: "delivery apps this year",
    assert(answer) {
      if (answer.answerType === "missing_data" && /not available/i.test(answer.directAnswer || "")) {
        throw new Error("returned missing-data stub");
      }
      if (answer.intent === "delivery_sales") throw new Error("intent still delivery_sales");
      const blob = `${answer.directAnswer || ""} ${(answer.insights || []).join(" ")}`;
      if (!/delivery|platform|year-to-date|ytd/i.test(blob)) {
        throw new Error("missing delivery platform / YTD context");
      }
    },
  },
  {
    label: "why were sales down yesterday",
    question: "why were sales down yesterday",
    assert(answer) {
      if (answer.intent !== "vault_business_reasoning") {
        throw new Error(`expected vault_business_reasoning, got ${answer.intent}`);
      }
    },
  },
];

function routeQuestion(question) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(ORCHESTRATOR_PATH)}).then((mod) => {
      const route = mod.routeIntent(${JSON.stringify(question)});
      process.stdout.write(JSON.stringify({
        intent: route.intent,
        confidence: route.confidence,
        vaultPeriod: route.vaultPeriod,
        topMatchId: route.debug?.topMatches?.[0]?.id ?? null,
      }));
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return JSON.parse(stdout.trim());
}

function readEnvLocalValue(key) {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return null;
  return fs.readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() || null;
}

async function getProdAccessToken() {
  const token = process.env.ASK_NAC_ACCESS_TOKEN?.trim();
  if (token) return token;
  throw new Error("Production mode requires ASK_NAC_ACCESS_TOKEN");
}

async function queryProd(question, branch = "khobar") {
  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.REACT_APP_SUPABASE_URL
    || readEnvLocalValue("REACT_APP_SUPABASE_URL");
  const token = await getProdAccessToken();
  const res = await fetch(`${supabaseUrl}/functions/v1/ask-nac`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, branch }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ask-nac ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function runLocalRouting() {
  let passed = 0;
  const failures = [];

  for (const tc of LOCAL_ROUTING_CASES) {
    try {
      const route = routeQuestion(tc.question);
      if (tc.expectIntent && route.intent !== tc.expectIntent) {
        throw new Error(`intent ${route.intent} !== ${tc.expectIntent} (top: ${route.topMatchId})`);
      }
      if (tc.forbidIntent && route.intent === tc.forbidIntent) {
        throw new Error(`forbidden intent ${tc.forbidIntent}`);
      }
      passed += 1;
      console.log(`  PASS  [routing] ${tc.label} → ${route.intent}`);
    } catch (err) {
      failures.push({ label: tc.label, error: err.message });
      console.log(`  FAIL  [routing] ${tc.label}: ${err.message}`);
    }
  }

  return { passed, total: LOCAL_ROUTING_CASES.length, failures };
}

async function runProdChecks() {
  let passed = 0;
  const failures = [];
  const branch = process.env.ASK_NAC_VERIFY_BRANCH || "khobar";

  for (const tc of PROD_CASES) {
    try {
      const answer = await queryProd(tc.question, branch);
      tc.assert(answer);
      passed += 1;
      console.log(`  PASS  [prod] ${tc.label} → ${answer.intent} / ${answer.confidence || "n/a"}`);
    } catch (err) {
      failures.push({ label: tc.label, error: err.message });
      console.log(`  FAIL  [prod] ${tc.label}: ${err.message}`);
    }
  }

  return { passed, total: PROD_CASES.length, failures };
}

async function main() {
  const prodMode = process.argv.includes("--prod");
  console.log(`Edge parity verifier (${prodMode ? "production" : "local routing"})`);

  const local = runLocalRouting();
  let prod = { passed: 0, total: 0, failures: [] };

  if (prodMode) {
    prod = await runProdChecks();
  }

  const totalPassed = local.passed + prod.passed;
  const totalCases = local.total + prod.total;
  const allFailures = [...local.failures, ...prod.failures];

  console.log(`\n${totalPassed}/${totalCases} passed`);
  if (allFailures.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
