/**
 * Production verification — Cash-up period analytics (Phase C1/C2).
 *
 * Read-only: POSTs questions to ask-nac only. No uploads, mutations, deletes, or sync.
 *
 * Run:
 *   node tmp-vault-verify/cash-up-period-prod-verify.mjs
 *
 * Environment:
 *   SUPABASE_URL                 Supabase project URL
 *   SUPABASE_ANON_KEY            Anon key (falls back to REACT_APP_* in .env.local)
 *   ASK_NAC_ACCESS_TOKEN         Bearer token — skips magic-link auth when set
 *   ASK_NAC_VERIFY_EMAIL         Magic-link user email (required when token unset)
 *   ASK_NAC_VERIFY_BRANCH        Branch scope (default: khobar)
 *   SUPABASE_PROJECT_REF         Project ref for `supabase projects api-keys` (when token unset)
 *   ASK_NAC_VERIFY_REDIRECT      Magic-link redirect URL (required when token unset)
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
  { label: "show sales last 7 days", question: "show sales last 7 days", expect: "range" },
  { label: "show sales last 14 days", question: "show sales last 14 days", expect: "range" },
  { label: "show delivery sales last 14 days", question: "show delivery sales last 14 days", expect: "range" },
  { label: "delivery orders last 14 days", question: "delivery orders last 14 days", expect: "range" },
  { label: "guests this month", question: "guests this month", expect: "range" },
  { label: "average spend this month", question: "average spend this month", expect: "range" },
  { label: "compare last 7 days vs previous 7 days", question: "compare last 7 days vs previous 7 days", expect: "compare" },
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
  const email = process.env.ASK_NAC_VERIFY_EMAIL?.trim() || null;
  const projectRef = process.env.SUPABASE_PROJECT_REF
    || (supabaseUrl && supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1])
    || null;
  const redirectTo = process.env.ASK_NAC_VERIFY_REDIRECT?.trim() || null;
  const netlifyOrigin = (process.env.ASK_NAC_NETLIFY_ORIGIN || redirectTo)?.replace(/\/$/, "") || null;

  if (!supabaseUrl) {
    throw new Error("Missing Supabase URL. Set SUPABASE_URL or REACT_APP_SUPABASE_URL.");
  }
  if (!anonKey) {
    throw new Error("Missing anon key. Set SUPABASE_ANON_KEY or REACT_APP_SUPABASE_ANON_KEY in .env.local.");
  }
  if (!accessToken && !email) {
    throw new Error("Set ASK_NAC_ACCESS_TOKEN or ASK_NAC_VERIFY_EMAIL for scoped auth.");
  }
  if (!accessToken && !projectRef) {
    throw new Error("Set SUPABASE_PROJECT_REF or SUPABASE_URL with a valid project ref.");
  }
  if (!accessToken && !redirectTo) {
    throw new Error("Set ASK_NAC_VERIFY_REDIRECT for magic-link auth.");
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
    return { pass: false, reason: `HTTP ${status}: ${response?.error || response?.message || JSON.stringify(response).slice(0, 200)}` };
  }
  const text = String(response?.answer || response?.narration || response?.directAnswer || "");
  const hasError = /timeout|WORKER_RESOURCE|canceling statement/i.test(text + JSON.stringify(response));
  if (hasError) return { pass: false, reason: text.slice(0, 120) || "error in response" };

  if (expect === "single-day") {
    const hasMetrics = (response?.keyMetrics?.length > 0) || /SAR|sales|guest/i.test(text);
    return { pass: hasMetrics, reason: hasMetrics ? "executive/single-day answer" : "no metrics" };
  }
  if (expect === "compare") {
    const hasCompare = /previous|vs|change|delta|%/i.test(text);
    return { pass: hasCompare, reason: hasCompare ? "compare answer" : text.slice(0, 120) };
  }
  const hasRange = /total|days|SAR|guest|delivery|month/i.test(text);
  return { pass: hasRange, reason: hasRange ? "range aggregation answer" : text.slice(0, 120) };
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
    } catch (e) {
      results.push({ query: q.label, pass: false, ms: Date.now() - started, reason: e.message });
      continue;
    }
    const verdict = classifyResult(response, status, q.expect);
    results.push({
      query: q.label,
      pass: verdict.pass,
      ms: Date.now() - started,
      reason: verdict.reason,
      answerType: response.answerType,
      snippet: String(response.answer || response.directAnswer || "").slice(0, 160),
    });
  }

  console.log(JSON.stringify({ results, allPass: results.every((r) => r.pass) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
