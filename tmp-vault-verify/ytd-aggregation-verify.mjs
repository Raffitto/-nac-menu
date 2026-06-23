/**
 * YTD / wide-range cash-up aggregation verifier (local routing + chunk helpers).
 *
 * Run:
 *   node tmp-vault-verify/ytd-aggregation-verify.mjs
 *   node tmp-vault-verify/ytd-aggregation-verify.mjs --prod
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const ORCHESTRATOR_PATH = path.join(REPO_ROOT, "supabase/functions/_shared/askNacOrchestrator.ts");
const AGG_PATH = path.join(REPO_ROOT, "supabase/functions/_shared/vaultCashUpAggregation.ts");

function loadAggregationModule() {
  const script = `
    import(${JSON.stringify(AGG_PATH)}).then((mod) => {
      process.stdout.write(JSON.stringify({
        ytdChunks: mod.splitRangeIntoMonthChunks("2026-01-01", "2026-06-20"),
        shouldChunkYtd: mod.shouldUseChunkedCashUpFetch("2026-01-01", "2026-06-20", "year_to_date"),
        shouldChunk7d: mod.shouldUseChunkedCashUpFetch("2026-06-14", "2026-06-20", "last_7_days"),
        skipDailyYtd: mod.shouldSkipDailyBreakdownForRange("2026-01-01", "2026-06-20", "year_to_date"),
      }));
    });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim());
}

function routeQuestion(question) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(ORCHESTRATOR_PATH)}).then((mod) => {
      const route = mod.routeIntent(${JSON.stringify(question)});
      process.stdout.write(JSON.stringify({ intent: route.intent, vaultPeriod: route.vaultPeriod }));
    });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim());
}

function readEnvLocalValue(key) {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return null;
  return fs.readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() || null;
}

async function queryProd(question, branch = "khobar") {
  const token = process.env.ASK_NAC_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("ASK_NAC_ACCESS_TOKEN required for --prod");
  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.REACT_APP_SUPABASE_URL
    || readEnvLocalValue("REACT_APP_SUPABASE_URL");
  const res = await fetch(`${supabaseUrl}/functions/v1/ask-nac`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, branch }),
  });
  if (!res.ok) throw new Error(`ask-nac ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const LOCAL_CASES = [
  {
    label: "delivery apps this year routes to vault + YTD period",
    run() {
      const route = routeQuestion("delivery apps this year");
      if (route.intent !== "vault_cash_up_summary") throw new Error(`intent ${route.intent}`);
      if (route.vaultPeriod?.periodType !== "year_to_date") throw new Error("missing year_to_date period");
    },
  },
  {
    label: "sales this year routes to vault + YTD period",
    run() {
      const route = routeQuestion("sales this year");
      if (route.intent !== "vault_cash_up_summary") throw new Error(`intent ${route.intent}`);
      if (!/year-to-date|ytd/i.test(route.vaultPeriod?.label || "")) throw new Error("missing YTD label");
    },
  },
  {
    label: "sales yesterday still vault not Foodics",
    run() {
      const route = routeQuestion("sales yesterday");
      if (route.intent !== "vault_cash_up_summary") throw new Error(`intent ${route.intent}`);
      if (route.intent === "sales_total") throw new Error("routed to sales_total");
    },
  },
  {
    label: "YTD uses monthly chunking helpers",
    run() {
      const agg = loadAggregationModule();
      if (!agg.shouldChunkYtd) throw new Error("YTD should chunk");
      if (agg.shouldChunk7d) throw new Error("7D should not chunk");
      if (!agg.skipDailyYtd) throw new Error("YTD should skip daily breakdown");
      if (!Array.isArray(agg.ytdChunks) || agg.ytdChunks.length < 2) {
        throw new Error(`expected multiple month chunks, got ${agg.ytdChunks?.length}`);
      }
    },
  },
];

const PROD_CASES = [
  {
    label: "show latest cash up",
    question: "show latest cash up",
    assert(answer) {
      if (!/cash|sales performance/i.test(answer.title || "")) throw new Error("expected cash-up title");
    },
  },
  {
    label: "delivery apps this year",
    question: "delivery apps this year",
    assert(answer) {
      if (/connection error|could not query/i.test(answer.directAnswer || "")) {
        throw new Error("DB connection error on YTD");
      }
      if (answer.answerType === "missing_data" && /not available/i.test(answer.directAnswer || "")) {
        throw new Error("missing-data stub");
      }
      if (!/year-to-date|ytd|2026/i.test(`${answer.title} ${answer.directAnswer}`)) {
        throw new Error("missing YTD label");
      }
      const blob = `${answer.directAnswer || ""} ${(answer.insights || []).join(" ")} ${(answer.keyMetrics || []).map((m) => m.label).join(" ")}`;
      if (!/delivery|platform/i.test(blob)) throw new Error("missing delivery/platform context");
    },
  },
  {
    label: "sales this year",
    question: "sales this year",
    assert(answer) {
      if (/connection error/i.test(answer.directAnswer || "")) throw new Error("timeout");
      if (answer.intent === "sales_total") throw new Error("Foodics route");
      if (!/year-to-date|ytd|2026/i.test(`${answer.title} ${answer.directAnswer}`)) {
        throw new Error("missing YTD context");
      }
    },
  },
  {
    label: "sales yesterday",
    question: "sales yesterday",
    assert(answer) {
      if (/foodics/i.test(`${answer.title} ${answer.directAnswer}`)) throw new Error("Foodics route");
      if (/2026-06-01.*2026-06-19/i.test(answer.directAnswer || "")) throw new Error("MTD Foodics range");
    },
  },
  {
    label: "why were sales down yesterday",
    question: "why were sales down yesterday",
    assert(answer) {
      if (answer.intent !== "vault_business_reasoning") throw new Error(`intent ${answer.intent}`);
    },
  },
];

function runLocal() {
  let passed = 0;
  const failures = [];
  for (const tc of LOCAL_CASES) {
    try {
      tc.run();
      passed += 1;
      console.log(`  PASS  [local] ${tc.label}`);
    } catch (err) {
      failures.push({ label: tc.label, error: err.message });
      console.log(`  FAIL  [local] ${tc.label}: ${err.message}`);
    }
  }
  return { passed, total: LOCAL_CASES.length, failures };
}

async function runProd() {
  let passed = 0;
  const failures = [];
  const branch = process.env.ASK_NAC_VERIFY_BRANCH || "khobar";
  for (const tc of PROD_CASES) {
    try {
      const answer = await queryProd(tc.question, branch);
      tc.assert(answer);
      passed += 1;
      console.log(`  PASS  [prod] ${tc.label}`);
    } catch (err) {
      failures.push({ label: tc.label, error: err.message });
      console.log(`  FAIL  [prod] ${tc.label}: ${err.message}`);
    }
  }
  return { passed, total: PROD_CASES.length, failures };
}

async function main() {
  const prodMode = process.argv.includes("--prod");
  console.log(`YTD aggregation verifier (${prodMode ? "production" : "local"})`);
  const local = runLocal();
  const prod = prodMode ? await runProd() : { passed: 0, total: 0, failures: [] };
  const totalPassed = local.passed + prod.passed;
  const totalCases = local.total + prod.total;
  console.log(`\n${totalPassed}/${totalCases} passed`);
  if ([...local.failures, ...prod.failures].length) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
