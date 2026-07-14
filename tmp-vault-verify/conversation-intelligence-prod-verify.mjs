/**
 * Production verification for Conversation Intelligence V1.
 *
 * Data scope (developer account): only Khobar has ingested vault/cash-up/logbook data.
 * Riyadh and Jeddah have no access/ingested data yet.
 *
 * Success criteria for conversation intelligence:
 * - usedContext=true on follow-up turns
 * - resolvedQuestion correctly rewrites the intent (branch, metric, period, filter)
 * - intent !== unknown
 *
 * Branch pivot / compare to Riyadh or Jeddah is PASS when routing is correct,
 * even if the final answer reports missing data. Do not treat no-data answers
 * as conversation failures.
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

const CHAINS = [
  {
    name: "Chain 1",
    questions: [
      "Show net sales for last 7 days",
      "Visualize it",
      "Break it down by day",
      "Compare to previous week",
      "Why was the worst day weak?",
    ],
    validate(turns) {
      const t1 = turns[0];
      const followUps = turns.slice(1);
      const checks = [];
      checks.push({ ok: t1.intent === "vault_cash_up_summary", label: "T1 cash-up intent" });
      checks.push({ ok: Boolean(t1.nextContext?.activeState?.dataset), label: "T1 dataset captured" });
      for (const [i, t] of followUps.entries()) {
        const n = i + 2;
        checks.push({ ok: t.conversationResolution?.usedContext === true, label: `T${n} usedContext` });
        checks.push({ ok: t.intent !== "unknown", label: `T${n} not unknown` });
        checks.push({ ok: !/clearer metric question/i.test(t.directAnswer || ""), label: `T${n} no clearer-metric fallback` });
      }
      const t2 = turns[1];
      checks.push({
        ok: /reused dataset|prior answer/i.test((t2.warnings || []).join(" ") + (t2.directAnswer || "")),
        label: "T2 dataset reuse",
      });
      const t4 = turns[3];
      checks.push({
        ok: /compare/i.test(t4.conversationResolution?.resolvedQuestion || ""),
        label: "T4 compare resolved",
      });
      const t5 = turns[4];
      checks.push({
        ok: /2026-|why/i.test(t5.conversationResolution?.resolvedQuestion || t5.directAnswer || ""),
        label: "T5 why uses worst day context",
      });
      return checks;
    },
  },
  {
    name: "Chain 2",
    questions: [
      "Show latest cash up",
      "Only delivery",
      "Only HungerStation",
      "Compare to previous day",
      "Why did delivery decline?",
    ],
    validate(turns) {
      const checks = [];
      checks.push({ ok: turns[0].intent !== "unknown", label: "T1 not unknown" });
      for (const [i, t] of turns.slice(1).entries()) {
        const n = i + 2;
        checks.push({ ok: t.conversationResolution?.usedContext === true, label: `T${n} usedContext` });
        checks.push({ ok: t.intent !== "unknown", label: `T${n} not unknown` });
      }
      const t2 = turns[1];
      checks.push({ ok: /delivery/i.test(t2.conversationResolution?.resolvedQuestion || ""), label: "T2 delivery filter" });
      const t3 = turns[2];
      checks.push({ ok: /hunger/i.test(t3.conversationResolution?.resolvedQuestion || ""), label: "T3 HungerStation filter" });
      return checks;
    },
  },
  {
    name: "Chain 3",
    questions: [
      "Show Khobar sales for last 7 days",
      "What about Riyadh?",
      "Compare both",
      "Which is stronger?",
      "Why?",
    ],
    validate(turns) {
      const checks = [];
      const t1 = turns[0];
      checks.push({ ok: t1.intent !== "unknown", label: "T1 not unknown" });
      checks.push({ ok: /khobar/i.test(t1.conversationResolution?.resolvedQuestion || t1.directAnswer || ""), label: "T1 Khobar anchor" });
      const t2 = turns[1];
      checks.push({ ok: t2.conversationResolution?.usedContext === true, label: "T2 usedContext" });
      checks.push({ ok: /riyadh/i.test(t2.conversationResolution?.resolvedQuestion || ""), label: "T2 branch pivot Riyadh (routing)" });
      checks.push({ ok: t2.intent !== "unknown", label: "T2 not unknown (no-data OK)" });
      checks.push({ ok: (t2.nextContext?.activeState?.branchHistory || []).length >= 2, label: "T2+ branch history" });
      const t3 = turns[2];
      checks.push({ ok: t3.conversationResolution?.usedContext === true, label: "T3 usedContext" });
      checks.push({
        ok: /compare/i.test(t3.conversationResolution?.resolvedQuestion || "")
          && /khobar/i.test(t3.conversationResolution?.resolvedQuestion || "")
          && /riyadh/i.test(t3.conversationResolution?.resolvedQuestion || ""),
        label: "T3 compare both branches (routing)",
      });
      checks.push({ ok: t3.intent !== "unknown", label: "T3 not unknown (no-data OK)" });
      const t4 = turns[3];
      checks.push({ ok: t4.conversationResolution?.usedContext === true, label: "T4 usedContext" });
      checks.push({ ok: /stronger|compare/i.test(t4.conversationResolution?.resolvedQuestion || ""), label: "T4 strength compare (routing)" });
      const t5 = turns[4];
      checks.push({ ok: t5.conversationResolution?.usedContext === true, label: "T5 usedContext" });
      checks.push({ ok: t5.intent !== "unknown", label: "T5 not unknown" });
      return checks;
    },
  },
];

const REGRESSION = [
  "show latest cash up",
  "health check",
  "dashboard readiness",
  "show everything learned from historical weekly dashboards",
];

function scoreContextAudit(chainResults) {
  let points = 0;
  const max = 10;
  const chain1 = chainResults.find((c) => c.name === "Chain 1");
  if (chain1?.turns?.[0]?.nextContext?.activeState?.dataset) points += 2;
  const followUps = chainResults.flatMap((c) => c.turns.slice(1));
  const usedContextRate = followUps.filter((t) => t.conversationResolution?.usedContext).length / Math.max(followUps.length, 1);
  points += Math.round(usedContextRate * 4);
  const unknownRate = followUps.filter((t) => t.intent === "unknown").length / Math.max(followUps.length, 1);
  points += unknownRate === 0 ? 2 : unknownRate < 0.2 ? 1 : 0;
  const datasetReuse = chainResults.flatMap((c) => c.turns).some((t) => /reused dataset/i.test((t.warnings || []).join(" ")));
  if (datasetReuse) points += 1;
  const branchHistory = chainResults.find((c) => c.name === "Chain 3")?.turns?.[1]?.nextContext?.activeState?.branchHistory?.length >= 2;
  if (branchHistory) points += 1;
  return { score: Math.min(points, max), max };
}

async function getToken() {
  const admin = createClient(url, sk, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "raffiazarian2@gmail.com",
    options: { redirectTo: "https://nac-os.netlify.app" },
  });
  const user = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: sess } = await user.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  return sess.session.access_token;
}

async function ask(token, question, conversationContext) {
  const started = Date.now();
  const res = await fetch(`${url}/functions/v1/ask-nac`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({
      question,
      branch: "khobar",
      filters: { branch: "khobar" },
      conversationContext,
    }),
  });
  const data = await res.json();
  return { ...data, ms: Date.now() - started, status: res.status };
}

async function runChain(token, chain) {
  let ctx = null;
  const turns = [];
  for (const question of chain.questions) {
    const data = await ask(token, question, ctx);
    ctx = data.nextContext || ctx;
    turns.push(data);
    console.log(`  Q: ${question}`);
    console.log(`    intent=${data.intent} usedContext=${data.conversationResolution?.usedContext} resolved=${data.conversationResolution?.resolvedQuestion?.slice(0, 80)}`);
    console.log(`    dataset=${Boolean(data.nextContext?.activeState?.dataset)} warnings=${(data.warnings || []).slice(0, 1).join("")}`);
    const answerText = typeof data.directAnswer === "string"
      ? data.directAnswer
      : (data.directAnswer ? "[structured answer]" : "");
    const routingOnly = /riyadh|jeddah/i.test(question) && /no (sales )?data|not available|no structured/i.test(answerText);
    console.log(`    answer=${answerText.slice(0, 120)}${routingOnly ? " [routing-only: no-data branch OK]" : ""}`);
  }
  const checks = chain.validate(turns);
  const failed = checks.filter((c) => !c.ok);
  return { name: chain.name, turns, checks, failed, pass: failed.length === 0 };
}

async function main() {
  let version = "unknown";
  try {
    const list = JSON.parse(execSync(`supabase functions list --project-ref ${ref} -o json`, { encoding: "utf8", cwd: REPO }));
    version = list.find((f) => f.slug === "ask-nac")?.version ?? version;
  } catch (_) { /* ignore */ }

  console.log(`ask-nac version (pre-deploy list): v${version}`);
  const token = await getToken();

  const chainResults = [];
  for (const chain of CHAINS) {
    console.log(`\n=== ${chain.name} ===`);
    chainResults.push(await runChain(token, chain));
  }

  console.log("\n=== Regression ===");
  const regression = [];
  for (const question of REGRESSION) {
    const data = await ask(token, question, null);
    const pass = data.intent !== "unknown" && !/clearer metric/i.test(data.directAnswer || "");
    console.log(`  ${pass ? "PASS" : "FAIL"} | ${question} | intent=${data.intent}`);
    regression.push({ question, pass, intent: data.intent });
  }

  const audit = scoreContextAudit(chainResults);
  console.log(`\n=== Context Audit Score: ${audit.score}/${audit.max} ===`);

  for (const chain of chainResults) {
    console.log(`\n${chain.name}: ${chain.pass ? "PASS" : "FAIL"}`);
    if (chain.failed.length) {
      for (const f of chain.failed) console.log(`  FAIL: ${f.label}`);
    }
  }

  const regFail = regression.filter((r) => !r.pass);
  const chainFail = chainResults.filter((c) => !c.pass);
  const exitCode = chainFail.length || regFail.length ? 1 : 0;
  console.log("\n=== SUMMARY ===", exitCode ? "FAIL" : "ALL PASS");
  console.log(JSON.stringify({ version, audit, chainFail: chainFail.map((c) => c.name), regFail }, null, 2));
  process.exitCode = exitCode;
}

main().catch((e) => { console.error(e); process.exit(1); });
