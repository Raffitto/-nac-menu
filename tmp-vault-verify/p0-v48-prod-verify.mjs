/**
 * P0 v48 production verification — latency, RPC path, coverage, confidence, branch memory.
 * Read-only POSTs to ask-nac Edge v48.
 */
import fs from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const QUERIES = [
  { label: "sales this year", question: "sales this year", ytd: true },
  { label: "delivery apps this year", question: "delivery apps this year", ytd: true },
  { label: "top delivery platform this year", question: "top delivery platform this year", ytd: true },
  { label: "why were sales down yesterday", question: "why were sales down yesterday", why: true },
  { label: "sales yesterday", question: "sales yesterday" },
  { label: "show latest cash up", question: "show latest cash up" },
];

function readEnvLocalValue(key) {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return null;
  return fs.readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() || null;
}

function loadConfig() {
  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.REACT_APP_SUPABASE_URL
    || readEnvLocalValue("REACT_APP_SUPABASE_URL");
  const anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.REACT_APP_SUPABASE_ANON_KEY
    || readEnvLocalValue("REACT_APP_SUPABASE_ANON_KEY");
  const branch = process.env.ASK_NAC_VERIFY_BRANCH || "khobar";
  const accessToken = process.env.ASK_NAC_ACCESS_TOKEN?.trim() || null;
  const email = process.env.ASK_NAC_VERIFY_EMAIL?.trim() || "raffiazarian2@gmail.com";
  const projectRef = process.env.SUPABASE_PROJECT_REF
    || supabaseUrl?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
    || null;
  const redirectTo = process.env.ASK_NAC_VERIFY_REDIRECT?.trim() || "https://nac-os.netlify.app";
  return { supabaseUrl, anonKey, branch, email, projectRef, redirectTo, accessToken };
}

function getServiceRole(projectRef) {
  const out = execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  const service = JSON.parse(out).find((k) => k.name === "service_role" || k.id === "service_role");
  if (!service?.api_key) throw new Error("service_role key not found");
  return service.api_key;
}

async function resolveAccessToken(config) {
  if (config.accessToken) return config.accessToken;
  const admin = createClient(config.supabaseUrl, getServiceRole(config.projectRef), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: config.email,
    options: { redirectTo: config.redirectTo },
  });
  if (error) throw error;
  const userClient = createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sessionData, error: verifyError } = await userClient.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) throw verifyError;
  return sessionData.session.access_token;
}

function detectRpcUsed(response) {
  const blob = JSON.stringify(response);
  return /get_vault_cash_up_range_aggregate/i.test(blob);
}

function detectCoverageNote(response) {
  const text = [
    response.directAnswer,
    ...(response.insights || []),
    ...(response.warnings || []),
    response.title,
    response.periodLabel,
  ].filter(Boolean).join(" ");
  return /coverage|partial|requested period|available|year-to-date|cash-up day/i.test(text);
}

function detectConfidence(response) {
  return Boolean(response.confidence && response.confidence !== "none");
}

function detectBranchMemory(response) {
  const insights = (response.insights || []).join(" ");
  const diag = response.diagnostics || {};
  return /Branch context/i.test(insights)
    || (Number(diag.branchMemoryCount) || 0) > 0
    || (Array.isArray(diag.rankedHypotheses) && diag.rankedHypotheses.length > 0);
}

function assessCorrectness(q, response) {
  const issues = [];
  const text = `${response.directAnswer || ""} ${response.title || ""}`;
  if (/connection error|timeout|WORKER_RESOURCE|could not query/i.test(text)) {
    issues.push("DB/timeout error");
  }
  if (q.ytd && response.intent === "sales_total") issues.push("routed to Foodics");
  if (q.label === "sales yesterday" && /2026-06-01.*2026-06-19|foodics/i.test(text)) {
    issues.push("Foodics MTD substitution");
  }
  if (q.why && response.intent !== "vault_business_reasoning") {
    issues.push(`wrong intent: ${response.intent}`);
  }
  if (q.ytd && !/year-to-date|ytd|2026/i.test(text)) {
    issues.push("missing YTD period label");
  }
  if (response.answerType === "missing_data" && /not available/i.test(text) && q.label.includes("latest")) {
    issues.push("unexpected missing data for latest cash up");
  }
  return issues;
}

async function main() {
  const config = loadConfig();
  const token = await resolveAccessToken(config);
  const edgeUrl = `${config.supabaseUrl}/functions/v1/ask-nac`;
  const results = [];

  console.log("P0 v48 Production Verification");
  console.log(`Edge: ${edgeUrl}`);
  console.log(`Branch: ${config.branch}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log("");

  for (const q of QUERIES) {
    const started = Date.now();
    let response = {};
    let status = 0;
    try {
      const res = await fetch(edgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: config.anonKey,
        },
        body: JSON.stringify({
          question: q.question,
          branch: config.branch,
          filters: { branch: config.branch },
        }),
      });
      status = res.status;
      response = await res.json();
    } catch (err) {
      results.push({ query: q.label, error: err.message, ms: Date.now() - started });
      continue;
    }

    const ms = Date.now() - started;
    const rpcUsed = detectRpcUsed(response);
    const coverageNote = detectCoverageNote(response);
    const confidence = detectConfidence(response);
    const branchMemory = q.why ? detectBranchMemory(response) : null;
    const issues = assessCorrectness(q, response);

    results.push({
      query: q.label,
      status,
      ms,
      intent: response.intent,
      answerType: response.answerType,
      confidence: response.confidence,
      rpcUsed,
      coverageNote,
      branchMemory,
      isAiGenerated: response.isAiGenerated,
      issues,
      directAnswerPreview: String(response.directAnswer || "").slice(0, 200),
      ytd: Boolean(q.ytd),
    });
  }

  console.log("| Query | ms | RPC | Coverage | Confidence | Branch mem | Intent | Pass |");
  console.log("|-------|-----|-----|----------|------------|------------|--------|------|");

  let ytdMaxMs = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.query} | ERROR | — | — | — | — | — | FAIL (${r.error}) |`);
      continue;
    }
    const pass = r.issues.length === 0 && r.status === 200;
    if (r.ytd) ytdMaxMs = Math.max(ytdMaxMs, r.ms);
    console.log(
      `| ${r.query} | ${r.ms} | ${r.rpcUsed ? "yes" : "no"} | ${r.coverageNote ? "yes" : "no"} | ${r.confidence || "—"} | ${r.branchMemory == null ? "n/a" : r.branchMemory ? "yes" : "no"} | ${r.intent} | ${pass ? "PASS" : "FAIL"} |`,
    );
    if (r.issues.length) console.log(`  Issues: ${r.issues.join("; ")}`);
    if (!pass && r.status !== 200) console.log(`  HTTP ${r.status}`);
  }

  console.log("");
  console.log("Detail previews:");
  for (const r of results) {
    if (r.error) continue;
    console.log(`\n--- ${r.query} (${r.ms}ms) ---`);
    console.log(`RPC: ${r.rpcUsed} | AI narrated: ${r.isAiGenerated}`);
    console.log(`Preview: ${r.directAnswerPreview}...`);
  }

  console.log("");
  console.log(`YTD max latency: ${ytdMaxMs}ms (threshold: 15000ms)`);
  console.log(`YTD under 15s: ${ytdMaxMs > 0 && ytdMaxMs < 15000 ? "YES — proceed to P3" : ytdMaxMs === 0 ? "UNKNOWN" : "NO — diagnose P0"}`);

  const failed = results.filter((r) => r.error || r.issues?.length || r.status !== 200);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
