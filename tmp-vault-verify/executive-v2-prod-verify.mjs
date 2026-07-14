/**
 * Production verification: Executive Intelligence v2 Ask NAC queries.
 */
import fs from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const REPO = "/Users/raffiazarian/Desktop/nac-menu";
const read = (k) => fs.readFileSync(`${REPO}/.env.local`, "utf8").match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const url = read("REACT_APP_SUPABASE_URL");
const anon = read("REACT_APP_SUPABASE_ANON_KEY");
const ref = url.match(/https:\/\/([^.]+)/)[1];
const sk = JSON.parse(execSync(`supabase projects api-keys --project-ref ${ref} -o json`, { encoding: "utf8", cwd: REPO }))
  .find((k) => k.name === "service_role").api_key;

const QUERIES = [
  "why were sales down yesterday",
  "generate weekly dashboard for Khobar week ending 20 June 2026",
  "show latest cash up",
  "show everything learned from historical weekly dashboards",
  "summarize daily briefing this month",
];

function checkResponse(q, data, ms) {
  const diag = data.diagnostics || {};
  const exec = data.executiveEvidence || {};
  const evidenceMap = diag.evidenceMap || exec.evidenceMap;
  const composition = diag.answerSourceComposition || exec.sourceComposition || diag.sourceComposition?.composition;
  const answer = String(data.directAnswer || "");
  const hasV2 = diag.executiveIntelligenceV2 === true;
  const hasEvidenceMap = Boolean(evidenceMap && (evidenceMap.facts || evidenceMap.known || answer.includes("Evidence map:")));
  const hasDisclosure = /Known:|Missing:|Disclosure:/i.test(answer) || Boolean(exec.disclosure || diag.disclosure);
  const hasComposition = Boolean(
    (Array.isArray(composition) && composition.length)
    || diag.answerSourceCompositionText
    || /Answer source composition:/i.test(answer),
  );
  const hasConfidence = Boolean(data.confidence && data.confidence !== "none");
  const inventedPatterns = /\b(exactly|precisely|confirmed live)\b.*\b(sar|guests?)\b/i;
  const noInvented = !inventedPatterns.test(answer) || /No |missing|not found|uploaded/i.test(answer);
  const missingDisclosed = !/Missing information:\n• None flagged/i.test(answer)
    || answer.includes("Missing:") || answer.includes("missing");

  const checks = {
    executiveIntelligenceV2: hasV2,
    evidenceMap: hasEvidenceMap,
    disclosure: hasDisclosure,
    answerSourceComposition: hasComposition,
    confidence: hasConfidence,
    noInventedData: noInvented,
    missingDisclosed: hasDisclosure || missingDisclosed,
    latencyMs: ms,
    latencyOk: ms < 45000,
  };
  const pass = Object.entries(checks)
    .filter(([k]) => !["latencyMs"].includes(k))
    .every(([, v]) => v === true);
  return { pass, checks, intent: data.intent, confidence: data.confidence };
}

async function main() {
  const admin = createClient(url, sk, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "raffiazarian2@gmail.com",
    options: { redirectTo: "https://nac-os.netlify.app" },
  });
  const user = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: sess } = await user.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  const token = sess.session.access_token;

  const results = [];
  for (const question of QUERIES) {
    const started = Date.now();
    const res = await fetch(`${url}/functions/v1/ask-nac`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question, branch: "khobar", filters: { branch: "khobar" } }),
    });
    const data = await res.json();
    const ms = Date.now() - started;
    const answer = String(data.directAnswer || "");
    const verdict = checkResponse(question, data, ms);
    console.log(`\n=== Q: ${question} ===`);
    console.log(`intent=${data.intent} confidence=${data.confidence} ${ms}ms PASS=${verdict.pass}`);
    console.log("checks:", JSON.stringify(verdict.checks, null, 2));
    console.log("directAnswer preview:", answer.slice(0, 350).replace(/\n/g, " "));
    results.push({ question, ...verdict, preview: answer.slice(0, 200) });
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((f) => ({ q: f.question, checks: f.checks })) }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
