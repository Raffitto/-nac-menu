/**
 * Ask NAC production latency audit — 3 runs per query, no code changes.
 */
import fs from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const REPO = "/Users/raffiazarian/Desktop/nac-menu";
const RUNS = 3;
const read = (k) => fs.readFileSync(`${REPO}/.env.local`, "utf8").match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const url = read("REACT_APP_SUPABASE_URL");
const anon = read("REACT_APP_SUPABASE_ANON_KEY");
const ref = url.match(/https:\/\/([^.]+)/)[1];
const sk = JSON.parse(execSync(`supabase projects api-keys --project-ref ${ref} -o json`, { encoding: "utf8", cwd: REPO }))
  .find((k) => k.name === "service_role").api_key;

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

function extractVaultTool(body) {
  const sources = body?.sources || [];
  const toolNames = sources.map((s) => s?.name).filter(Boolean);
  const intent = body?.intent || null;
  const routing = body?.routingDebug || {};
  const topTool = routing?.selectedTool || routing?.vaultTool || null;
  if (toolNames.length) return toolNames.join(", ");
  if (topTool) return String(topTool);
  if (intent) return `intent:${intent}`;
  return "unknown";
}

function datasetReused(body) {
  const warnings = body?.warnings || [];
  const notes = body?.conversationResolution?.resolutionNotes || [];
  const text = [...warnings, ...notes].join(" ");
  return /reused dataset|without a new vault query|no new vault query/i.test(text)
    || (body?.conversationResolution?.usedContext === true && body?.title?.includes("Daily breakdown"));
}

function narrationSkipped(body) {
  return body?.aiConnected === false && body?.isAiGenerated !== true;
}

function summarizeRun(body, timings) {
  const timingMs = body?.responseMeta?.timingMs || null;
  const narrationSkippedMeta = body?.responseMeta?.narrationSkipped;
  return {
    totalLatencyMs: timings.totalMs,
    ttfbMs: timings.ttfbMs,
    edgeLatencyMs: timingMs?.total ?? null,
    supabaseQueryMs: timingMs
      ? (timingMs.vaultTool || 0) + (timingMs.knowledgeHealth || 0)
      : null,
    openAiNarrationMs: timingMs?.openAiNarration ?? null,
    vaultTool: extractVaultTool(body),
    intent: body?.intent || null,
    datasetReused: datasetReused(body),
    narrationSkipped: narrationSkippedMeta ?? narrationSkipped(body),
    aiConnected: body?.aiConnected ?? null,
    isAiGenerated: body?.isAiGenerated ?? null,
    usedContext: body?.conversationResolution?.usedContext ?? false,
    title: body?.title || null,
    responseSizeBytes: timings.responseSizeBytes,
    timingMs,
    hasExecutiveV2: Boolean(body?.executiveEvidence || body?.diagnostics?.executiveIntelligenceV2),
    sourceCount: (body?.sources || []).length,
    keyMetricCount: (body?.keyMetrics || []).length,
    matchCount: body?.matches?.length ?? null,
    error: body?.error || null,
  };
}

async function askTimed(token, question, conversationContext = null) {
  const payload = { question, branch: "khobar", filters: { branch: "khobar" }, conversationContext };
  const started = performance.now();
  const res = await fetch(`${url}/functions/v1/ask-nac`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify(payload),
  });
  const ttfbMs = Math.round(performance.now() - started);
  const text = await res.text();
  const totalMs = Math.round(performance.now() - started);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: "invalid_json", raw: text.slice(0, 200) };
  }
  return {
    body,
    timings: { totalMs, ttfbMs, responseSizeBytes: Buffer.byteLength(text, "utf8"), httpStatus: res.status },
  };
}

function avg(nums) {
  const v = nums.filter((n) => Number.isFinite(n));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

function stats(runs) {
  const latencies = runs.map((r) => r.totalLatencyMs);
  return {
    avgLatencyMs: avg(latencies),
    minLatencyMs: Math.min(...latencies),
    maxLatencyMs: Math.max(...latencies),
    avgResponseSizeBytes: avg(runs.map((r) => r.responseSizeBytes)),
    narrationSkippedAll: runs.every((r) => r.narrationSkipped),
    datasetReusedAll: runs.every((r) => r.datasetReused),
    intents: [...new Set(runs.map((r) => r.intent))],
    vaultTools: [...new Set(runs.map((r) => r.vaultTool))],
  };
}

async function runQuery(token, label, fn) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    process.stderr.write(`  run ${i + 1}/${RUNS}: ${label}…\n`);
    const { body, timings } = await fn();
    runs.push(summarizeRun(body, timings));
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { query: label, runs, summary: stats(runs) };
}

async function main() {
  const token = await getToken();
  const results = [];

  results.push(await runQuery(token, "show latest cash up", () =>
    askTimed(token, "show latest cash up")));

  results.push(await runQuery(token, "show net sales for last 7 days", () =>
    askTimed(token, "show net sales for last 7 days")));

  results.push(await runQuery(token, "visualize it (after last-7-days)", async () => {
    const { body: sales } = await askTimed(token, "show net sales for last 7 days");
    return askTimed(token, "Visualize it", sales.nextContext);
  }));

  results.push(await runQuery(token, "health check", () =>
    askTimed(token, "health check")));

  results.push(await runQuery(token, "dashboard readiness", () =>
    askTimed(token, "dashboard readiness")));

  results.push(await runQuery(token, "why were sales down yesterday", () =>
    askTimed(token, "why were sales down yesterday")));

  results.push(await runQuery(token, "show everything learned from historical weekly dashboards", () =>
    askTimed(token, "show everything learned from historical weekly dashboards")));

  const leaderboard = [...results]
    .sort((a, b) => (b.summary.avgLatencyMs || 0) - (a.summary.avgLatencyMs || 0))
    .map((r, i) => ({
      rank: i + 1,
      query: r.query,
      avgLatencyMs: r.summary.avgLatencyMs,
      minMs: r.summary.minLatencyMs,
      maxMs: r.summary.maxLatencyMs,
      narrationSkipped: r.summary.narrationSkippedAll,
      datasetReused: r.summary.datasetReusedAll,
      intent: r.summary.intents.join(", "),
      vaultTool: r.summary.vaultTools.join(", "),
    }));

  const out = {
    auditedAt: new Date().toISOString(),
    branch: "khobar",
    runsPerQuery: RUNS,
    note: "Edge/Supabase/OpenAI step timings are not exposed in API responses; totalLatencyMs is end-to-end HTTP.",
    results,
    leaderboard,
  };

  const outPath = `${REPO}/tmp-vault-verify/ask-nac-latency-audit-results.json`;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ outPath, leaderboard }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
