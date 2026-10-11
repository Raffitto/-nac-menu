/**
 * Runs the Deno Edge orchestrator under Node (type stripping, Node >= 22.6) in a
 * child process, the same technique as askNacEdgeOrchestratorRouting.test.js.
 * The edge client is an in-memory stub defined inside the child; it records
 * every call and refuses writes. No network.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../..");
const orchestratorPath = path.join(root, "supabase/functions/_shared/askNacOrchestrator.ts");

function runEdge(body) {
  const script = `
    globalThis.Deno = { env: { get: () => undefined } };
    globalThis.fetch = () => { throw new Error("network disabled in oracle-d1 edge harness"); };
    const calls = [];
    const WRITES = new Set(["insert", "update", "upsert", "delete"]);
    function builder(table) {
      const target = {};
      const proxy = new Proxy(target, {
        get(_, prop) {
          if (prop === "then") {
            return (resolve, reject) => Promise.resolve(
              calls.some((c) => c.table === table && WRITES.has(c.method))
                ? { data: null, error: { message: "stub refuses writes" } }
                : { data: [], error: null, count: 0 },
            ).then(resolve, reject);
          }
          return (...args) => { calls.push({ table, method: String(prop) }); return proxy; };
        },
      });
      return proxy;
    }
    const supabase = {
      from(table) { calls.push({ table, method: "from" }); return builder(table); },
      rpc(name) { calls.push({ table: null, method: "rpc", name }); return Promise.resolve({ data: null, error: { message: "stub refuses rpc" } }); },
      storage: { from() { return { download: async () => ({ data: null, error: { message: "stub" } }), list: async () => ({ data: [], error: null }) }; } },
    };
    import(${JSON.stringify(orchestratorPath)}).then(async (mod) => {
      const out = await mod.processAskNacOnEdge(supabase, ${JSON.stringify(body)});
      process.stdout.write(JSON.stringify({ out, calls }));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return JSON.parse(stdout.trim().split("\n").pop());
}

function routeEdge(question) {
  const script = `
    globalThis.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(orchestratorPath)}).then((mod) => {
      process.stdout.write(JSON.stringify({ intent: mod.routeIntent(${JSON.stringify(question)}).intent }));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return JSON.parse(stdout.trim().split("\n").pop()).intent;
}

module.exports = { runEdge, routeEdge, orchestratorPath };
