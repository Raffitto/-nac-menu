#!/usr/bin/env node
/**
 * Optional Netlify ignore helper (not wired in netlify.toml by default).
 * Exit 0 = skip build. Exit 1 = build.
 *
 * Skip only when every changed path is engineering/docs/test-only.
 * Any src/, supabase/, public/, package.json, or netlify.toml change builds.
 */
import { execSync } from "child_process";

const base = process.env.CACHED_COMMIT_REF || "HEAD~1";
const head = process.env.COMMIT_REF || "HEAD";

let diff = "";
try {
  diff = execSync(`git diff --name-only ${base} ${head}`, { encoding: "utf8" });
} catch {
  process.exit(1);
}

const files = diff.split("\n").map((s) => s.trim()).filter(Boolean);
if (!files.length) process.exit(0);

const skipPrefixes = [
  ".cursor/",
  "docs/engineering/",
];
const skipExact = new Set([
  "docs/engineering/CURSOR_ENGINEERING_SYSTEM.md",
  "docs/engineering/BACKLOG.md",
  "scripts/netlify-ignore-non-runtime.mjs",
  "scripts/verify-focused.mjs",
]);

const isSkip = (file) =>
  skipExact.has(file)
  || skipPrefixes.some((p) => file.startsWith(p))
  || /\.test\.(js|jsx|ts)$/.test(file)
  || file.endsWith(".md");

if (files.every(isSkip)) {
  console.log("netlify-ignore: non-runtime only — skip build");
  process.exit(0);
}

console.log("netlify-ignore: runtime or mixed change — build");
process.exit(1);
