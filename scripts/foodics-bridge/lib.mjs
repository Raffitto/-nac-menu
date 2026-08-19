import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

export function loadEnv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadBridgeEnv() {
  const candidates = [
    process.env.FOODICS_BRIDGE_ENV,
    path.join(root, "scripts/foodics-bridge/.env.local"),
    "/Users/raffiazarian/Desktop/nac-menu-release/foodics-bridge/.env.local",
    path.join(root, ".env.local"),
  ].filter(Boolean);
  for (const filePath of candidates) loadEnv(filePath);
}

export function createNodeFileSystem() {
  return {
    exists(filePath) {
      return fs.existsSync(filePath);
    },
    read(filePath) {
      return fs.readFileSync(filePath, "utf8");
    },
    write(filePath, content) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    },
    mkdir(dirPath) {
      fs.mkdirSync(dirPath, { recursive: true });
    },
  };
}

export function defaultDataDir() {
  return process.env.FOODICS_BRIDGE_DATA_DIR
    || path.join(os.homedir(), "Library/Application Support/NAC/foodics-bridge");
}

import { execFileSync } from "node:child_process";

export function invokeFabric(body) {
  const script = `
    global.Deno = { env: { get: (k) => process.env[k] } };
    import fs from "node:fs";
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim());
}

export function parseArgs(argv) {
  const args = { source: "scheduler", branch: process.env.FOODICS_BRIDGE_BRANCH_ID || "khobar", dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--source" && argv[i + 1]) {
      args.source = argv[++i];
    } else if (argv[i] === "--branch" && argv[i + 1]) {
      args.branch = argv[++i];
    } else if (argv[i] === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

export async function upsertCanonicalBundle({ url, key, branchId, businessDate, bundle }) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  };
  const mapped = invokeFabric(`
    return mod.canonicalBundleToSupabaseRows(${JSON.stringify(bundle)});
  `);
  const deleteQs = `branch_id=eq.${branchId}&business_date=eq.${businessDate}`;
  for (const table of ["commerce_sessions", "commerce_order_items", "commerce_orders"]) {
    const res = await fetch(`${url}/rest/v1/${table}?${deleteQs}`, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404) {
      throw new Error(`delete_${table}_failed:${res.status}:${await res.text()}`);
    }
  }
  for (const [table, rows] of Object.entries(mapped)) {
    if (!rows.length) continue;
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: "POST",
      headers,
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      throw new Error(`upsert_${table}_failed:${res.status}:${await res.text()}`);
    }
  }
}

export function launchAgentLoaded(label) {
  try {
    const out = execFileSync("launchctl", ["list"], { encoding: "utf8" });
    return out.split(/\r?\n/).some((line) => line.includes(label));
  } catch {
    return null;
  }
}
