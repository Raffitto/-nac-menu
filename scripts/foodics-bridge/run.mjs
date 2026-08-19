#!/usr/bin/env node
/**
 * Compatibility alias for the GH-worker entrypoint name.
 * Canonical LaunchAgent command is run-nightly.mjs.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const nightly = fileURLToPath(new URL("./run-nightly.mjs", import.meta.url));
const result = spawnSync(process.execPath, [nightly, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
