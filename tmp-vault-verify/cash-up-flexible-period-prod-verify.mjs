/**
 * Production verification — Ask NAC flexible period cash-up analytics.
 *
 * Read-only: POSTs questions to ask-nac only. No uploads, mutations, deletes, or sync.
 *
 * Run:
 *   node tmp-vault-verify/cash-up-flexible-period-prod-verify.mjs
 *
 * Environment (secrets are never hardcoded in this file):
 *   SUPABASE_URL                 Supabase project URL
 *   SUPABASE_ANON_KEY            Anon key (falls back to REACT_APP_SUPABASE_ANON_KEY in .env.local)
 *   ASK_NAC_ACCESS_TOKEN         Bearer token — skips magic-link auth when set
 *   ASK_NAC_VERIFY_EMAIL         Magic-link user email (required when token unset)
 *   ASK_NAC_VERIFY_BRANCH        Branch scope (default: khobar)
 *   SUPABASE_PROJECT_REF         Project ref for `supabase projects api-keys` (when token unset)
 *   ASK_NAC_VERIFY_REDIRECT      Magic-link redirect URL (default: https://nac-os.netlify.app/)
 */
import fs from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const QUERIES = [
  { label: "show latest cash up", question: "show latest cash up", expect: "single-day" },
  { label: "sales from June 1 to June 15", question: "sales from June 1 to June 15", expect: "range" },
  { label: "delivery sales between June 5 and June 20", question: "delivery sales between June 5 and June 20", expect: "range" },
  { label: "guests from June 1 until June 18", question: "guests from June 1 until June 18", expect: "range" },
  { label: "average spend between June 1 and June 10", question: "average spend between June 1 and June 10", expect: "range" },
  { label: "compare June 1-15 vs May 1-15", question: "compare June 1-15 vs May 1-15", expect: "compare" },
  { label: "compare first half of June vs second half of June", question: "compare first half of June vs second half of June", expect: "compare" },
  { label: "delivery mix last 14 days", question: "delivery mix last 14 days", expect: "range" },
];

function readEnvLocalAnonKey() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return null;
  return fs.readFileSync(envPath, "utf8").match(/^REACT_APP_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim() || null;
}

function loadConfig() {
  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.REACT_APP_SUPABASE_URL
    || "https://zeyhvjuraqnlbdycgrme.supabase.co";
  const anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.REACT_APP_SUPABASE_ANON_KEY
    || readEnvLocalAnonKey();
  const branch = process.env.ASK_NAC_VERIFY_BRANCH || "khobar";
  const email = process.env.ASK_NAC_VERIFY_EMAIL || "raffiazarian@gmail.com";
  const projectRef = process.env.SUPABASE_PROJECT_REF || "zeyhvjuraqnlbdycgrme";
  const redirectTo = process.env.ASK_NAC_VERIFY_REDIRECT || "https://nac-os.netlify.app/";
  const accessToken = process.env.ASK_NAC_ACCESS_TOKEN?.trim() || null;

  if (!anonKey) {
    throw new Error("Missing anon key. Set SUPABASE_ANON_KEY or REACT_APP_SUPABASE_ANON_KEY in .env.local.");
  }

  return { supabaseUrl, anonKey, branch, email, projectRef, redirectTo, accessToken };
}

function getServiceRole(projectRef) {
  const out = execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  const keys = JSON.parse(out);
  const service = keys.find((k) => k.name === "service_role" || k.id === "service_role");
  if (!service?.api_key) throw new Error("service_role key not found via Supabase CLI");
  return service.api_key;
}

async function resolveAccessToken(config) {
  if (config.accessToken) return config.accessToken;

  const serviceRole = getServiceRole(config.projectRef);
  const admin = createClient(config.supabaseUrl, serviceRole, {
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

function classifyResult(response, status, expect) {
  if (status !== 200) {
    return {
      pass: false,
      reason: response?.error || response?.message || `HTTP ${status}`,
    };
  }

  const payload = JSON.stringify(response);
  const text = String(response?.answer || response?.narration || response?.directAnswer || "");
  const keyMetricsCount = Array.isArray(response?.keyMetrics) ? response.keyMetrics.length : 0;
  const warningsCount = Array.isArray(response?.warnings) ? response.warnings.length : 0;

  if (/timeout|WORKER_RESOURCE|canceling statement/i.test(text + payload)) {
    return { pass: false, reason: "timeout or worker error" };
  }

  if (expect === "single-day") {
    const pass = keyMetricsCount > 0 || /SAR|sales|guest|cash up|Net/i.test(text);
    return { pass, reason: pass ? "single-day metrics present" : "no single-day metrics" };
  }

  if (expect === "compare") {
    const metricLabels = (response?.keyMetrics || []).map((m) => String(m?.label || "")).join(" ");
    const pass = keyMetricsCount > 0
      && (/delta|change|comparison|vs/i.test(metricLabels + text));
    return { pass, reason: pass ? "compare metrics present" : "missing compare metrics" };
  }

  const pass = keyMetricsCount > 0 || /total|SAR|guest|delivery|days|avg|average/i.test(text);
  return { pass, reason: pass ? "range metrics present" : "missing range metrics" };
}

function printResultRow(result) {
  const statusLabel = result.pass ? "PASS" : "FAIL";
  console.log(`[${statusLabel}] ${result.query}`);
  console.log(`  status: ${result.status}`);
  console.log(`  intent: ${result.intent ?? "—"}`);
  console.log(`  title: ${result.title ?? "—"}`);
  console.log(`  keyMetrics: ${result.keyMetricsCount}`);
  console.log(`  warnings: ${result.warningsCount}`);
  if (!result.pass && result.reason) console.log(`  reason: ${result.reason}`);
  if (result.ms != null) console.log(`  ms: ${result.ms}`);
}

async function main() {
  const config = loadConfig();
  const token = await resolveAccessToken(config);
  const edgeUrl = `${config.supabaseUrl}/functions/v1/ask-nac`;
  const results = [];

  for (const q of QUERIES) {
    const started = Date.now();
    let status = 0;
    let response = {};

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
    } catch (error) {
      results.push({
        query: q.label,
        pass: false,
        status: 0,
        intent: null,
        title: null,
        keyMetricsCount: 0,
        warningsCount: 0,
        reason: error.message,
        ms: Date.now() - started,
      });
      continue;
    }

    const verdict = classifyResult(response, status, q.expect);
    results.push({
      query: q.label,
      pass: verdict.pass,
      status,
      intent: response?.intent ?? null,
      title: response?.title ?? null,
      keyMetricsCount: Array.isArray(response?.keyMetrics) ? response.keyMetrics.length : 0,
      warningsCount: Array.isArray(response?.warnings) ? response.warnings.length : 0,
      reason: verdict.reason,
      ms: Date.now() - started,
    });
  }

  console.log("");
  console.log("Ask NAC flexible period production verification");
  console.log(`branch: ${config.branch}`);
  console.log(`edge: ${edgeUrl}`);
  console.log("");

  for (const result of results) {
    printResultRow(result);
    console.log("");
  }

  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass);

  console.log("Summary");
  console.log(`  total passed: ${passed.length}`);
  console.log(`  total failed: ${failed.length}`);
  if (failed.length) {
    console.log(`  failed queries: ${failed.map((r) => r.query).join(", ")}`);
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
