#!/usr/bin/env node
/**
 * Deterministic NAC AI-control worker. One shot. No busy-wait. No model required.
 * Agent-class tasks are not executed here unless CURSOR_API_KEY is used by the workflow.
 */
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const control = join(root, "ai-control");

function read(rel) {
  return readFileSync(join(control, rel), "utf8");
}

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: m[2] };
}

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", ...opts }).trim();
}

function nowIso() {
  return new Date().toISOString();
}

const state = JSON.parse(read("STATE.json"));
const nextRaw = read("NEXT_TASK.md");
const { meta } = parseFrontmatter(nextRaw);
const taskId = meta.taskId || null;

if (!taskId) {
  console.log("ai-control: no taskId in NEXT_TASK.md — idle exit");
  process.exit(0);
}

if (state.lastCompletedTaskId === taskId && state.status === "awaiting_review") {
  console.log(`ai-control: ${taskId} already handed off — idle exit`);
  process.exit(0);
}

if (state.lock?.holder && state.lock.taskId && state.lock.taskId !== taskId) {
  console.error(`ai-control: locked by ${state.lock.holder} on ${state.lock.taskId}`);
  process.exit(2);
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const head = git(["rev-parse", "HEAD"]);
if (state.branch && branch !== state.branch) {
  console.error(`ai-control: unexpected branch ${branch} (state ${state.branch})`);
  process.exit(2);
}

state.status = "working";
state.activeTaskId = taskId;
state.lock = { holder: "ai-control-worker", taskId, acquiredAt: nowIso() };
state.headSha = head;
state.lastUpdatedAt = nowIso();
writeFileSync(join(control, "STATE.json"), JSON.stringify(state, null, 2) + "\n");

try {
  if (meta.deterministic === "true" && taskId === "NAC-CTRL-0001") {
    const ossPath = join(root, "supabase/functions/_shared/companyIntelligence/externalReality/ossReferenceRegistry.ts");
    let oss = readFileSync(ossPath, "utf8");
    if (!oss.includes("CONTROL_PROTOCOL_META")) {
      oss += `\nexport const CONTROL_PROTOCOL_META = Object.freeze({\n  protocolVersion: 1,\n  validated: true,\n  taskId: "NAC-CTRL-0001",\n});\n`;
      writeFileSync(ossPath, oss);
    }
  }

  const pattern = meta.testBudget || "aiControlProtocol";
  execFileSync("npx", [
    "react-scripts", "test", "--watchAll=false",
    `--testPathPattern=${pattern}`,
    "--testTimeout=60000",
  ], {
    cwd: root,
    env: { ...process.env, CI: "true" },
    stdio: "inherit",
  });

  const newHead = git(["rev-parse", "HEAD"]);
  const handoff = `# LAST_HANDOFF

- task ID: ${taskId}
- result: PASS
- changes: deterministic control-protocol proof (metadata + focused tests)
- files: ai-control/*, ossReferenceRegistry.ts (CONTROL_PROTOCOL_META if added)
- commit SHA: ${newHead}
- tests: ${pattern} (see CI log)
- deploys: none
- cost/model usage: no Cursor model invoked by this worker; on-demand blocked; individual plan % not officially observable
- blockers: none
- remaining issues: supervisor should issue the next product task or leave idle
- recommended next step: set awaiting_review; do not start another milestone until NEXT_TASK.md changes
`;
  writeFileSync(join(control, "LAST_HANDOFF.md"), handoff);

  state.status = "awaiting_review";
  state.lastCompletedTaskId = taskId;
  state.activeTaskId = null;
  state.lock = { holder: null, taskId: null, acquiredAt: null };
  state.headSha = newHead;
  state.lastUpdatedAt = nowIso();
  state.blocker = null;
  writeFileSync(join(control, "STATE.json"), JSON.stringify(state, null, 2) + "\n");
  console.log(`ai-control: ${taskId} PASS → awaiting_review`);
} catch (err) {
  state.status = "blocked";
  state.blocker = String(err && err.message || err).slice(0, 500);
  state.lock = { holder: null, taskId: null, acquiredAt: null };
  state.lastUpdatedAt = nowIso();
  writeFileSync(join(control, "STATE.json"), JSON.stringify(state, null, 2) + "\n");
  writeFileSync(join(control, "LAST_HANDOFF.md"), `# LAST_HANDOFF\n\n- task ID: ${taskId}\n- result: BLOCKED\n- blockers: ${state.blocker}\n`);
  console.error(err);
  process.exit(1);
}
