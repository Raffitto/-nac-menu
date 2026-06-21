/**
 * Production verification — Ask NAC cash-up executive brief + export payload.
 *
 * Read-only: POSTs one cash-up question and validates executive brief / export shape.
 * No uploads, mutations, deletes, or sync.
 *
 * Run:
 *   node tmp-vault-verify/executive-brief-prod-verify.mjs
 *
 * Environment:
 *   SUPABASE_URL                 Supabase project URL
 *   SUPABASE_ANON_KEY            Anon key (falls back to REACT_APP_* in .env.local)
 *   ASK_NAC_ACCESS_TOKEN         Bearer token — skips magic-link auth when set
 *   ASK_NAC_VERIFY_EMAIL         Magic-link user email (required when token unset)
 *   ASK_NAC_VERIFY_BRANCH        Branch scope (default: khobar)
 *   SUPABASE_PROJECT_REF         Project ref for `supabase projects api-keys` (when token unset)
 *   ASK_NAC_VERIFY_REDIRECT      Magic-link redirect URL (default: https://nac-os.netlify.app/)
 *   ASK_NAC_NETLIFY_ORIGIN       Netlify app origin for bundle checks (default: redirect origin)
 */
import fs from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

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
  const redirectTo = process.env.ASK_NAC_VERIFY_REDIRECT || "https://nac-os.netlify.app/";
  const netlifyOrigin = (process.env.ASK_NAC_NETLIFY_ORIGIN || redirectTo).replace(/\/$/, "");

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

  return { supabaseUrl, anonKey, branch, email, projectRef, redirectTo, accessToken, netlifyOrigin };
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

async function checkNetlifyBundle(netlifyOrigin) {
  const manifest = await (await fetch(`${netlifyOrigin}/asset-manifest.json`)).json();
  const mainJs = manifest.files?.["main.js"] || "";
  let foundElectronic = false;
  for (const rel of Object.values(manifest.files || {})) {
    if (!String(rel).endsWith(".js")) continue;
    const text = await (await fetch(`${netlifyOrigin}${rel}`)).text();
    if (text.includes("Electronic Payments")) {
      foundElectronic = true;
      break;
    }
  }
  return { mainJs, foundElectronic };
}

async function main() {
  const config = loadConfig();
  const report = { netlify: null, api: null, export: null, ui: null, errors: [] };

  try {
    report.netlify = await checkNetlifyBundle(config.netlifyOrigin);
  } catch (e) {
    report.errors.push(`Netlify check: ${e.message}`);
  }

  let token;
  try {
    token = await resolveAccessToken(config);
  } catch (e) {
    report.errors.push(`Auth: ${e.message}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const edgeUrl = `${config.supabaseUrl}/functions/v1/ask-nac`;
  const res = await fetch(edgeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: config.anonKey,
    },
    body: JSON.stringify({
      question: "show latest cash up",
      branch: config.branch,
      range: "today",
      filters: { branch: config.branch, selectedRange: "today" },
    }),
  });

  const response = await res.json();
  report.api = {
    status: res.status,
    answerType: response.answerType,
    hasExecutiveBrief: Boolean(response.executiveBrief),
    executiveSections: response.executiveBrief
      ? Object.keys(response.executiveBrief).filter((k) => response.executiveBrief[k]?.length !== 0)
      : [],
    keyMetricLabels: (response.keyMetrics || []).map((m) => m.label),
    cardSalesLabel: (response.keyMetrics || []).find((m) => m.key === "card_sales")?.label,
    deliveryMetric: (response.keyMetrics || []).find((m) =>
      /delivery/i.test(String(m.key || m.label)),
    ),
    directAnswerType: typeof response.directAnswer,
    objectObjectInJson: JSON.stringify(response).includes("[object Object]"),
    periodLabel: response.periodLabel,
    branchLabel: response.branchLabel,
  };

  try {
    execSync(
      "npx esbuild src/intelligence/askNac/export/askNacExportPayload.js --bundle --platform=node --format=cjs --outfile=tmp-vault-verify/askNacExportPayload.bundle.cjs",
      { cwd: REPO_ROOT, stdio: "pipe" },
    );
    execSync(
      "npx esbuild src/intelligence/askNac/export/executiveBriefExport.js --bundle --platform=node --format=cjs --outfile=tmp-vault-verify/executiveBriefExport.bundle.cjs",
      { cwd: REPO_ROOT, stdio: "pipe" },
    );
    const { buildAskNacExportPayload } = require("./askNacExportPayload.bundle.cjs");
    const {
      hasExecutiveBriefPayload,
      formatExportAnswerText,
      extractExecutiveKpiMetrics,
    } = require("./executiveBriefExport.bundle.cjs");

    const payload = buildAskNacExportPayload({
      question: "show latest cash up",
      response,
      filters: { branch: config.branch, selectedRange: "today" },
    });

    const kpis = extractExecutiveKpiMetrics(payload);
    report.export = {
      hasExecutiveBrief: hasExecutiveBriefPayload(payload),
      electronicPaymentsLabel: payload.keyMetrics?.find((m) => m.key === "card_sales")?.label,
      kpiCount: kpis.length,
      kpiLabels: kpis.map((k) => k.label),
      sectionsPresent: {
        executiveSummary: Boolean(payload.executiveBrief?.executiveSummary),
        keyFindings: (payload.executiveBrief?.keyFindings || []).length > 0,
        operationalRisks: (payload.executiveBrief?.operationalRisks || []).length > 0,
        recommendedActions: Array.isArray(payload.executiveBrief?.recommendedActions),
        dataSources: (payload.executiveBrief?.dataSources || []).length > 0,
      },
      noObjectObject:
        !JSON.stringify(payload).includes("[object Object]") &&
        formatExportAnswerText(payload.answer?.directAnswer) !== "[object Object]",
      metricsAppendixCount: (payload.keyMetrics || []).length,
    };
  } catch (e) {
    report.errors.push(`Export payload: ${e.message}`);
  }

  report.ui = {
    debugPanelDefaultHidden: String(process.env.REACT_APP_ASK_NAC_CASHUP_DEBUG || "") !== "true",
    prodBundleHasElectronicPayments: report.netlify?.foundElectronic === true,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
