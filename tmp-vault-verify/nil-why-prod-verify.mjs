/**
 * Production verification — Ask NAC NIL business reasoning (why queries).
 *
 * Read-only: POSTs questions to ask-nac only. No uploads, mutations, deletes, or sync.
 *
 * Run:
 *   node tmp-vault-verify/nil-why-prod-verify.mjs
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

const EXPECTED_INTENT = "vault_business_reasoning";

const QUERIES = [
  { label: "why were sales down last 7 days", question: "why were sales down last 7 days" },
  { label: "why were sales lower June 1-15 vs May 1-15", question: "why were sales lower June 1-15 vs May 1-15" },
  { label: "why did guests drop last 14 days", question: "why did guests drop last 14 days" },
  { label: "why is delivery lower this month", question: "why is delivery lower this month" },
  { label: "why was average spend down between June 1 and June 10", question: "why was average spend down between June 1 and June 10" },
];

const REQUIRED_SECTIONS = [
  { key: "facts", label: "Confirmed Facts", patterns: [/Confirmed Facts/i] },
  { key: "correlations", label: "Correlations", patterns: [/Evidence-Based Correlations/i, /\bCorrelations\b/i] },
  { key: "hypotheses", label: "Hypotheses", patterns: [/Hypotheses/i] },
  { key: "recommendations", label: "Recommendations", patterns: [/Recommendations/i] },
  { key: "confidence", label: "Confidence", patterns: [/\bConfidence\b/i] },
];

const EXTERNAL_CONTEXT_PATTERNS = [
  /No external context sources are connected yet/i,
  /external context sources are not connected/i,
];

const FORBIDDEN_NARRATION_MARKERS = [
  /\bOpenAI narration failed\b/i,
  /\bAI explanation unavailable\b/i,
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

function extractAnswerText(response) {
  const direct = response?.directAnswer;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object") return JSON.stringify(direct);
  return String(response?.answer || response?.narration || response?.summary || "");
}

function detectSections(text) {
  const detected = {};
  for (const section of REQUIRED_SECTIONS) {
    detected[section.key] = section.patterns.some((p) => p.test(text));
  }
  return detected;
}

function hasExternalContextGuard(text, warnings = []) {
  if (EXTERNAL_CONTEXT_PATTERNS.some((p) => p.test(text))) return true;
  return warnings.some((w) => EXTERNAL_CONTEXT_PATTERNS.some((p) => p.test(String(w))));
}

function classifyNilWhyResult(response, status) {
  if (status !== 200) {
    return {
      pass: false,
      reason: response?.error || response?.message || `HTTP ${status}`,
      sections: {},
      externalContext: false,
    };
  }

  const payload = JSON.stringify(response);
  const text = extractAnswerText(response);
  const warnings = Array.isArray(response?.warnings) ? response.warnings : [];

  if (/timeout|WORKER_RESOURCE|canceling statement/i.test(text + payload)) {
    return { pass: false, reason: "timeout or worker error", sections: {}, externalContext: false };
  }

  if (response?.intent !== EXPECTED_INTENT) {
    return {
      pass: false,
      reason: `intent ${response?.intent ?? "null"} (expected ${EXPECTED_INTENT})`,
      sections: detectSections(text),
      externalContext: hasExternalContextGuard(text, warnings),
    };
  }

  if (response?.isAiGenerated === true) {
    return {
      pass: false,
      reason: "isAiGenerated=true (expected deterministic NIL answer)",
      sections: detectSections(text),
      externalContext: hasExternalContextGuard(text, warnings),
    };
  }

  if (FORBIDDEN_NARRATION_MARKERS.some((p) => p.test(text + payload))) {
    return {
      pass: false,
      reason: "OpenAI narration fallback detected",
      sections: detectSections(text),
      externalContext: hasExternalContextGuard(text, warnings),
    };
  }

  const sections = detectSections(text);
  const missingSections = REQUIRED_SECTIONS.filter((s) => !sections[s.key]).map((s) => s.label);
  const externalContext = hasExternalContextGuard(text, warnings);

  const hasNilStructure = sections.facts && sections.hypotheses && sections.recommendations;
  const proseOnly = text.length > 80 && !sections.facts && !/Confirmed Facts/i.test(text);

  if (proseOnly) {
    return {
      pass: false,
      reason: "prose-only answer without NIL section structure",
      sections,
      externalContext,
    };
  }

  if (missingSections.length) {
    return {
      pass: false,
      reason: `missing sections: ${missingSections.join(", ")}`,
      sections,
      externalContext,
    };
  }

  if (!externalContext) {
    return {
      pass: false,
      reason: "missing external context guard (No external context sources are connected yet)",
      sections,
      externalContext: false,
    };
  }

  if (!hasNilStructure) {
    return {
      pass: false,
      reason: "incomplete NIL structure",
      sections,
      externalContext,
    };
  }

  return { pass: true, reason: "NIL why answer valid", sections, externalContext };
}

function printSectionLines(sections) {
  const lines = [];
  for (const section of REQUIRED_SECTIONS) {
    const mark = sections[section.key] ? "✓" : "✗";
    lines.push(`${mark} ${section.label}`);
  }
  return lines;
}

function printResultBlock(result) {
  const statusLabel = result.pass ? "PASS" : "FAIL";
  console.log(statusLabel);
  console.log(result.query);
  console.log(`HTTP: ${result.status}`);
  console.log(`Intent: ${result.intent ?? "—"}`);
  console.log("Sections:");
  for (const line of printSectionLines(result.sections || {})) {
    console.log(`  ${line}`);
  }
  console.log(`Warnings: ${result.warningsCount}`);
  if (!result.pass && result.reason) console.log(`Reason: ${result.reason}`);
  if (result.ms != null) console.log(`ms: ${result.ms}`);
  console.log("");
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
        sections: {},
        warningsCount: 0,
        reason: error.message,
        ms: Date.now() - started,
      });
      continue;
    }

    const verdict = classifyNilWhyResult(response, status);
    results.push({
      query: q.label,
      pass: verdict.pass,
      status,
      intent: response?.intent ?? null,
      sections: verdict.sections,
      warningsCount: Array.isArray(response?.warnings) ? response.warnings.length : 0,
      reason: verdict.reason,
      ms: Date.now() - started,
    });
  }

  console.log("NIL Why Verification");
  console.log(`branch: ${config.branch}`);
  console.log(`edge: ${edgeUrl}`);
  console.log("");

  for (const result of results) {
    printResultBlock(result);
  }

  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass);

  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length) {
    console.log(`Failed queries: ${failed.map((r) => r.query).join(", ")}`);
  }
  console.log("");
  console.log(`Result: ${failed.length ? "FAIL" : "PASS"}`);

  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
