/**
 * Oracle D1 — A. Ask NAC reachability (T1, T2, T3).
 * Design (T3): the Edge Function routes `theoretical_consumption` and returns an
 * explicit structured hand-off; the client executes the shared read-only tool
 * (src/inventory/truth) locally and labels the answer localFallback. The client
 * also re-runs locally when an older server answers intent "unknown" for a
 * question the client routes to theoretical_consumption.
 */
import { askNac, serverAnswerNeedsLocalExecution } from "../../intelligence/askNac/askNacClient";
import { ASK_NAC_INTENTS, routeAskNacIntent } from "../../intelligence/askNac/intentRouter";
import { fetchWithDeadline } from "../../lib/fetchDeadline";
import { allTrackedWriteCalls, trackedStub } from "../__fixtures__/oracle-d1/supabaseStub";
import { consumptionTables, SYN_NOW, synItem } from "../__fixtures__/oracle-d1/synFixtures";

jest.mock("../../lib/supabase", () => ({ supabase: null }));
jest.mock("../../lib/fetchDeadline", () => ({ fetchWithDeadline: jest.fn() }));

const { runEdge, routeEdge } = require("./edgeHarness");

const T1_QUESTIONS = [
  "How much SYN-milk should Khobar have consumed yesterday?",
  "How much SYN-milk should Khobar have consumed last week?",
  "What is the theoretical consumption of SYN-milk in Khobar yesterday?",
];
const GENERIC = /limited or unavailable/i;

function threeSalesStub() {
  const items = [1, 2, 3].map((n) => synItem({
    id: `SYN-I-T2-${n}`,
    date: "2026-10-11",
    menuItemId: "SYN-M-LATTE",
    name: "SYN Latte",
    quantity: 1,
  }));
  return trackedStub({ tables: consumptionTables({ items, freshness: "2026-10-11" }) });
}

function okResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

const SESSION = { access_token: "SYN-TOKEN-NOT-A-SECRET" };
const PROFILE = { authenticated: true, allBranches: true, role: "owner", branchScope: null };

beforeAll(() => {
  process.env.REACT_APP_ASK_NAC_FUNCTION_URL = "https://syn-ask-nac.invalid/functions/v1/ask-nac";
});
afterAll(() => {
  delete process.env.REACT_APP_ASK_NAC_FUNCTION_URL;
});
beforeEach(() => {
  // Jest 27: modern fake timers, then pin the clock. Only Date matters here.
  jest.useFakeTimers("modern");
  jest.setSystemTime(new Date(SYN_NOW));
  fetchWithDeadline.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("T1 server routes consumption questions", () => {
  test.each(T1_QUESTIONS)("edge routeIntent(%s) = theoretical_consumption", (question) => {
    expect(routeEdge(question)).toBe("theoretical_consumption");
    expect(routeAskNacIntent(question).intent).toBe(ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION);
  });
  test("wastage does not route to theoretical_consumption", () => {
    expect(routeEdge("What was our recorded wastage last week?")).not.toBe("theoretical_consumption");
    expect(routeAskNacIntent("What was our recorded wastage last week?").intent).not.toBe(ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION);
  });
});

describe("T2 signed-in path executes the shared consumption module", () => {
  test("edge returns a structured hand-off (no total, no reads, not generic)", () => {
    const { out, calls } = runEdge({
      question: T1_QUESTIONS[0],
      profileHint: { authenticated: true, allBranches: true },
    });
    expect(out.intent).toBe("theoretical_consumption");
    expect(out.tool.status).toBe("UNAVAILABLE");
    expect(out.tool.quantity).toBeNull();
    expect(out.tool.reason).toBeTruthy();
    expect(out.tool.postsStock).toBe(false);
    expect(out.postsStock).toBe(false);
    expect(out.handoff).toMatchObject({ kind: "client_local_tool", intent: "theoretical_consumption" });
    expect(out.directAnswer).not.toMatch(GENERIC);
    expect(calls.filter((c) => ["insert", "update", "upsert", "delete", "rpc"].includes(c.method))).toEqual([]);
    expect(calls.filter((c) => /commerce|inventory_/.test(String(c.table)))).toEqual([]);
  });

  test("edge refuses a branch outside the caller's scope", () => {
    const { out } = runEdge({
      question: T1_QUESTIONS[0],
      profileHint: { authenticated: true, allBranches: false, branchScope: "riyadh" },
    });
    expect(out.intent).toBe("theoretical_consumption");
    expect(out.tool.status).toBe("UNAVAILABLE");
    expect(out.handoff).toBeNull();
  });

  test("client executes the hand-off with the shared module: 3 SYN sales x 100 ml = 300 millilitre PROVISIONAL", async () => {
    const { out } = runEdge({ question: T1_QUESTIONS[0], profileHint: { authenticated: true, allBranches: true } });
    fetchWithDeadline.mockResolvedValue(okResponse(out));
    const supabase = threeSalesStub();
    const result = await askNac({ question: T1_QUESTIONS[0], supabase, session: SESSION, profile: PROFILE });
    expect(result.intent).toBe(ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION);
    expect(result.tool.engine).toBe("inventory_truth");
    expect(result.tool.status).toBe("PROVISIONAL");
    expect(result.tool.quantity).toBe("300");
    expect(result.tool.unit).toBe("millilitre");
    expect(result.tool.postsStock).toBe(false);
    expect(result.localFallback).toBe(true);
    expect(result.serverConnected).toBe(true);
    expect(result.directAnswer).not.toMatch(GENERIC);
    expect(result.warnings.join(" ")).toMatch(/server hand-off/);
  });
});

describe("T3 client does not hide a server 'unknown'", () => {
  test("server intent unknown -> client re-runs locally with localFallback and a warning", async () => {
    fetchWithDeadline.mockResolvedValue(okResponse({
      intent: "unknown",
      directAnswer: "That data is limited or unavailable.",
      serverConnected: true,
    }));
    const supabase = threeSalesStub();
    const result = await askNac({ question: T1_QUESTIONS[0], supabase, session: SESSION, profile: PROFILE });
    expect(result.intent).toBe(ASK_NAC_INTENTS.THEORETICAL_CONSUMPTION);
    expect(result.localFallback).toBe(true);
    expect(result.tool.status).toBe("PROVISIONAL");
    expect(result.tool.postsStock).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/could not route this question/);
  });

  test("a supported server answer is passed through unchanged", () => {
    expect(serverAnswerNeedsLocalExecution({ intent: "sales_total" }, "net sales yesterday")).toBeNull();
    expect(serverAnswerNeedsLocalExecution({ intent: "unknown" }, "hello there")).toBeNull();
  });
});

describe("T28 (A)", () => {
  test("no insert/update/upsert/delete/rpc on any stub in this file", () => {
    expect(allTrackedWriteCalls()).toEqual([]);
  });
});
