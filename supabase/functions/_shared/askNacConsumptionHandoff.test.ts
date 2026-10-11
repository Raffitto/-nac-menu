// Oracle D1 T1/T2 (Deno): the Edge orchestrator routes theoretical consumption
// and returns an explicit client hand-off. SYNTHETIC inputs only. No network:
// run with `deno test --no-check --deny-net --allow-read --allow-env`.
import assert from "node:assert/strict";
import { processAskNacOnEdge, routeIntent } from "./askNacOrchestrator.ts";

const QUESTIONS = [
  "How much SYN-milk should Khobar have consumed yesterday?",
  "How much SYN-milk should Khobar have consumed last week?",
  "What is the theoretical consumption of SYN-milk in Khobar yesterday?",
];

type Call = { table: string | null; method: string };

function stubClient() {
  const calls: Call[] = [];
  const builder = (table: string): unknown => {
    const proxy: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null, count: 0 });
        }
        return () => {
          calls.push({ table, method: String(prop) });
          return proxy;
        };
      },
    });
    return proxy;
  };
  const client = {
    from(table: string) {
      calls.push({ table, method: "from" });
      return builder(table);
    },
    rpc(name: string) {
      calls.push({ table: null, method: `rpc:${name}` });
      return Promise.resolve({ data: null, error: { message: "stub refuses rpc" } });
    },
  };
  return { client, calls };
}

Deno.test("T1 edge routeIntent routes consumption questions", () => {
  for (const question of QUESTIONS) {
    assert.equal(routeIntent(question).intent, "theoretical_consumption", question);
  }
  assert.notEqual(routeIntent("What was our recorded wastage last week?").intent, "theoretical_consumption");
});

Deno.test("T2 processAskNacOnEdge returns a structured hand-off, no writes, no inventory reads", async () => {
  const { client, calls } = stubClient();
  // deno-lint-ignore no-explicit-any
  const out = await processAskNacOnEdge(client as any, {
    question: QUESTIONS[0],
    profileHint: { authenticated: true, allBranches: true },
  }) as Record<string, any>;
  assert.equal(out.intent, "theoretical_consumption");
  assert.equal(out.tool.status, "UNAVAILABLE");
  assert.equal(out.tool.quantity, null);
  assert.equal(out.tool.postsStock, false);
  assert.equal(out.postsStock, false);
  assert.ok(String(out.tool.reason).length > 0);
  assert.equal(out.handoff.kind, "client_local_tool");
  assert.equal(out.handoff.intent, "theoretical_consumption");
  assert.equal(out.serverConnected, true);
  assert.doesNotMatch(String(out.directAnswer), /limited or unavailable/i);
  assert.deepEqual(calls.filter((c) => /insert|update|upsert|delete|rpc/.test(c.method)), []);
  assert.deepEqual(calls.filter((c) => /commerce|inventory_/.test(String(c.table))), []);
});

Deno.test("T2 hand-off is refused for a branch outside the caller's scope", async () => {
  const { client } = stubClient();
  // deno-lint-ignore no-explicit-any
  const out = await processAskNacOnEdge(client as any, {
    question: QUESTIONS[0],
    profileHint: { authenticated: true, allBranches: false, branchScope: "riyadh" },
  }) as Record<string, any>;
  assert.equal(out.tool.status, "UNAVAILABLE");
  assert.equal(out.handoff, null);
});
