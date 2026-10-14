#!/usr/bin/env node
/**
 * Netlify ignore command.
 * Exit 0 = skip the build. Exit 1 = build.
 * https://docs.netlify.com/build/configure-builds/ignore-builds/
 *
 * Docs, tests, and CI config skip. Any runtime path builds.
 */
import { execSync } from "child_process";
import { pathToFileURL } from "url";

const RUNTIME_PREFIXES = [
  "src/",
  "public/",
  "supabase/",
  "scripts/",
];
const RUNTIME_EXACT = new Set([
  "package.json",
  "package-lock.json",
  "netlify.toml",
]);

export function shouldBuild(files) {
  if (!files.length) return false;
  return files.some((file) => {
    if (/\.test\.(js|jsx|ts|tsx)$/.test(file)) return false;
    if (file.startsWith("docs/") || file.startsWith(".github/") || file.startsWith(".cursor/") || file.startsWith("tmp-vault-verify/")) {
      return false;
    }
    if (file.endsWith(".md")) return false;
    if (RUNTIME_EXACT.has(file)) return true;
    if (file === "scripts/netlify-ignore-non-runtime.mjs") return false;
    if (file === "scripts/verify-focused.mjs") return false;
    if (file === "scripts/optimize-menu-images.mjs") return false;
    return RUNTIME_PREFIXES.some((prefix) => file.startsWith(prefix));
  });
}

function changedFiles() {
  const base = process.env.CACHED_COMMIT_REF || "HEAD~1";
  const head = process.env.COMMIT_REF || "HEAD";
  const diff = execSync(`git diff --name-only ${base} ${head}`, { encoding: "utf8" });
  return diff.split("\n").map((line) => line.trim()).filter(Boolean);
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  let files = [];
  try {
    files = changedFiles();
  } catch {
    console.log("netlify-ignore: diff unavailable — build");
    process.exit(1);
  }
  if (shouldBuild(files)) {
    console.log("netlify-ignore: runtime change — build");
    process.exit(1);
  }
  console.log("netlify-ignore: docs or tests only — skip build");
  process.exit(0);
}
