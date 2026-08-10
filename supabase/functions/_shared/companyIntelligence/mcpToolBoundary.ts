/**
 * MCP-ready tool boundary — portable capability → tool contracts.
 * Not a full MCP server.
 */

import type { CapabilityId } from "./capabilityRegistry.ts";
import { CAPABILITY_REGISTRY, mapCapabilitiesToTools } from "./capabilityRegistry.ts";

export type McpToolDescriptor = {
  name: string;
  capability: CapabilityId | null;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const MCP_TOOL_CONTRACTS: McpToolDescriptor[] = [
  {
    name: "sales.get_period_performance",
    capability: "commercial.performance",
    description: "Get canonical commercial performance for a branch/period",
    inputSchema: {
      type: "object",
      properties: {
        branchId: { type: "string" },
        startDate: { type: "string" },
        endDate: { type: "string" },
      },
      required: ["branchId", "startDate", "endDate"],
    },
  },
  {
    name: "sales.compare_periods",
    capability: "commercial.compare",
    description: "Compare two commercial periods with matched coverage",
    inputSchema: {
      type: "object",
      properties: {
        branchId: { type: "string" },
        currentStart: { type: "string" },
        currentEnd: { type: "string" },
        baselineStart: { type: "string" },
        baselineEnd: { type: "string" },
      },
      required: ["branchId", "currentStart", "currentEnd", "baselineStart", "baselineEnd"],
    },
  },
  {
    name: "operations.search_logbooks",
    capability: "operations.review",
    description: "Search in-range operational logbook evidence",
    inputSchema: {
      type: "object",
      properties: {
        branchId: { type: "string" },
        startDate: { type: "string" },
        endDate: { type: "string" },
        query: { type: "string" },
      },
      required: ["branchId", "startDate", "endDate"],
    },
  },
  {
    name: "company.get_branch_timeline",
    capability: "company.branch_timeline",
    description: "Get branch opening/closure/timeline facts",
    inputSchema: {
      type: "object",
      properties: { branchId: { type: "string" } },
      required: ["branchId"],
    },
  },
  {
    name: "calendar.resolve_period",
    capability: "calendar.resolve_period",
    description: "Resolve semantic period expressions to exact dates",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string" },
        referenceDate: { type: "string" },
      },
      required: ["expression"],
    },
  },
  {
    name: "research.get_historical_weather",
    capability: "research.historical_weather",
    description: "Bounded historical weather lookup",
    inputSchema: {
      type: "object",
      properties: {
        geography: { type: "string" },
        startDate: { type: "string" },
        endDate: { type: "string" },
      },
      required: ["geography", "startDate", "endDate"],
    },
  },
];

export function listMcpToolContracts(): McpToolDescriptor[] {
  return MCP_TOOL_CONTRACTS;
}

export function capabilitiesToMcpTools(capabilityIds: CapabilityId[]): McpToolDescriptor[] {
  const implTools = new Set(mapCapabilitiesToTools(capabilityIds));
  return MCP_TOOL_CONTRACTS.filter((t) => {
    if (!t.capability) return false;
    const impl = CAPABILITY_REGISTRY[t.capability]?.implementationTool;
    return impl ? implTools.has(impl) : false;
  });
}
