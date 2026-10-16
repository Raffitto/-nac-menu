import assert from "node:assert/strict";
import { runAskNacAgent } from "./askNacAgentLoop.ts";

Deno.test("agent withholds a figure the tool did not return", async () => {
  let step = 0;
  const result = await runAskNacAgent({
    question: "How many deliveries were done this month and how much total?",
    branchHint: "khobar",
    allowedBranchIds: ["khobar"],
    allBranches: false,
    executeTool: async (tool) => ({
      tool,
      text: "Khobar: 76 delivery orders. SAR 9,641 delivery revenue. Average delivery order value is SAR 126.86.",
      evidenceNumbers: [76, 9641, 126.86],
    }),
    completeModel: async () => {
      step += 1;
      if (step === 1) {
        return {
          content: JSON.stringify({
            action: "call_tool",
            tool: "delivery_summary",
            args: { branch: "khobar", startDate: "2026-10-01", endDate: "2026-10-15" },
          }),
          promptTokens: 50,
          completionTokens: 20,
        };
      }
      return {
        content: JSON.stringify({
          action: "final",
          answer: "Khobar had 100 delivery orders and SAR 9,641 revenue.",
        }),
        promptTokens: 80,
        completionTokens: 30,
      };
    },
  });
  assert.equal(result.verified, false);
  assert.equal(result.confidence, "low");
  assert.match(result.directAnswer, /76 delivery orders/);
  assert.doesNotMatch(result.directAnswer, /\b100\b/);
});

Deno.test("agent calls only an authorized tool and keeps verified numbers", async () => {
  const calls: string[] = [];
  let step = 0;
  const result = await runAskNacAgent({
    question: "What is unusual about Khobar deliveries this month?",
    branchHint: "khobar",
    allowedBranchIds: ["khobar"],
    allBranches: false,
    executeTool: async (tool, args) => {
      calls.push(`${tool}:${args.branch}`);
      return {
        tool,
        text: "Khobar: 76 delivery orders. SAR 9,641 delivery revenue.",
        orders: 76,
        sales: 9641,
        evidenceNumbers: [76, 9641, 126.86],
      };
    },
    completeModel: async () => {
      step += 1;
      if (step === 1) {
        return {
          content: JSON.stringify({
            action: "call_tool",
            tool: "delivery_summary",
            args: { branch: "khobar", startDate: "2026-10-01", endDate: "2026-10-15" },
          }),
          promptTokens: 80,
          completionTokens: 30,
        };
      }
      return {
        content: JSON.stringify({
          action: "final",
          answer: "Khobar published 76 delivery orders and SAR 9,641 delivery revenue for 2026-10-01 to 2026-10-15. A hypothesis: Hunger is the largest platform, but that split was not in this evidence.",
          hypotheses: ["Hunger may be the largest platform."],
        }),
        promptTokens: 100,
        completionTokens: 50,
      };
    },
  });
  assert.deepEqual(calls, ["delivery_summary:khobar"]);
  assert.equal(result.verified, true);
  assert.match(result.directAnswer, /76 delivery orders/);
  assert.equal(result.promptTokens, 180);
});

Deno.test("a why question must use more than the sales total", async () => {
  const calls: string[] = [];
  let step = 0;
  const result = await runAskNacAgent({
    question: "Why did Khobar sales decrease?",
    branchHint: "khobar",
    allowedBranchIds: ["khobar"],
    allBranches: false,
    executeTool: async (tool) => {
      calls.push(tool);
      if (tool === "logbook_summary") {
        return { tool, text: "No published logbook summary for that branch and period.", evidenceNumbers: [] };
      }
      return { tool, text: "Khobar net sales 500.", netSales: 500, evidenceNumbers: [500] };
    },
    completeModel: async () => {
      step += 1;
      if (step === 1) {
        return {
          content: JSON.stringify({ action: "call_tool", tool: "cash_up_summary", args: { branch: "khobar", startDate: "2026-10-01", endDate: "2026-10-15" } }),
          promptTokens: 40,
          completionTokens: 20,
        };
      }
      if (step === 2) {
        return {
          content: JSON.stringify({ action: "call_tool", tool: "logbook_summary", args: { branch: "khobar", startDate: "2026-10-01", endDate: "2026-10-15" } }),
          promptTokens: 40,
          completionTokens: 20,
        };
      }
      return {
        content: JSON.stringify({
          action: "final",
          answer: "Khobar net sales were 500. I cannot explain the decrease because the logbook is not published.",
        }),
        promptTokens: 40,
        completionTokens: 30,
      };
    },
  });
  assert.deepEqual(calls, ["cash_up_summary", "logbook_summary"]);
  assert.equal(result.verified, true);
  assert.match(result.directAnswer, /cannot explain/);
  assert.doesNotMatch(result.directAnswer, /weather/);
});

Deno.test("agent refuses a tool for a branch the user cannot access", async () => {
  let executed = 0;
  const result = await runAskNacAgent({
    question: "Show Riyadh sales",
    branchHint: "riyadh",
    allowedBranchIds: ["khobar"],
    allBranches: false,
    executeTool: async () => {
      executed += 1;
      return { evidenceNumbers: [1] };
    },
    completeModel: async () => ({
      content: JSON.stringify({
        action: "call_tool",
        tool: "cash_up_summary",
        args: { branch: "riyadh", startDate: "2026-10-01", endDate: "2026-10-15" },
      }),
      promptTokens: 40,
      completionTokens: 20,
    }),
  });
  assert.equal(executed, 0);
  assert.equal(result.verified, false);
  assert.match(result.directAnswer, /not stating|enough published evidence|could not verify/i);
});
