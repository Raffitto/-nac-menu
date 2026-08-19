/**
 * Load the TypeScript commerce engine from this repo without adding it to the
 * Deno Edge bundle. Node 22 strips types via --experimental-strip-types.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fabricPath = path.join(repoRoot, "supabase/functions/_shared/companyIntelligence/index.ts");

export function runEngine(body, extra = {}) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const raw = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: extra.env || process.env,
    timeout: extra.timeout || 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(raw.trim());
}

export function engineCalendar(asOf) {
  return runEngine(`
    return {
      current: mod.riyadhCalendarDate(${JSON.stringify(asOf)}),
      newestSafe: mod.newestSafeCompletedDate(${JSON.stringify(asOf)}),
      nightly: mod.isNightlySchedulerWindow(${JSON.stringify(asOf)}),
      schedule: mod.FOODICS_BRIDGE_NIGHTLY,
    };
  `);
}

export function enginePlan(input) {
  return runEngine(`
    return mod.planCompletedDayAcquisition(${JSON.stringify(input)});
  `);
}

export { repoRoot, fabricPath };
