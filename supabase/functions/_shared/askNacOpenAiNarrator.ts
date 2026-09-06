/**
 * Server-side OpenAI analyst narrator — rewrites prose only; never changes verified numbers.
 */

import { coercePlainTextDirectAnswer } from "./askNacResponseHelpers.ts";

const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
const MAX_FACT_ROWS = 24;
const MAX_TOKENS = 600;
const TEMPERATURE = 0.2;

type KeyMetric = { label: string; value: unknown; unit?: string; source?: string; note?: string };
type DeterministicAnswer = Record<string, unknown>;

type NarrationContext = {
  question?: string;
  intent?: string;
  tool?: Record<string, unknown> | null;
  diagnostics?: Record<string, unknown> | null;
};

function trimToolFacts(tool: Record<string, unknown> | null | undefined) {
  if (!tool) return null;
  const clone = { ...tool };
  for (const key of ["facts", "items", "aggregated", "coverage"]) {
    const arr = clone[key];
    if (Array.isArray(arr) && arr.length > MAX_FACT_ROWS) {
      clone[key] = arr.slice(0, MAX_FACT_ROWS);
      clone[`_${key}_truncated`] = arr.length - MAX_FACT_ROWS;
    }
  }
  return clone;
}

export function buildNarrationPayload(
  deterministic: DeterministicAnswer,
  { question, intent, tool, diagnostics }: NarrationContext,
) {
  return {
    question: question || "",
    intent: intent || deterministic.intent || null,
    verified: {
      answerType: deterministic.answerType,
      title: deterministic.title,
      directAnswer: deterministic.directAnswer,
      keyMetrics: (deterministic.keyMetrics as KeyMetric[]) || [],
      insights: (deterministic.insights as string[]) || [],
      recommendations: (deterministic.recommendations as string[]) || [],
      confidence: deterministic.confidence,
      periodLabel: deterministic.periodLabel,
      branchLabel: deterministic.branchLabel,
    },
    toolFacts: trimToolFacts(tool),
    diagnostics: diagnostics || deterministic.diagnostics || null,
    coverage: deterministic.coverageContract || null,
    rules: [
      "Rewrite directAnswer, optional executiveSummary, insights, and recommendations for clarity.",
      "Never invent or change numeric metric values.",
      "Do not remove or alter sources, warnings, missingData, or vaultSources.",
      "Keep answers grounded in verified facts only.",
      "Use coverage.spokenLabel as the only period window you may name.",
      "Never include coverage.requestedEnd if it is listed in coverage.missingDates.",
      "If coverage.coverageStatus is PARTIAL or CURRENT_DAY_NOT_COMPLETE, say so far this period through coverage.availableEnd.",
      deterministic.coverageContract
        ? `Coverage instruction: ${String((deterministic.coverageContract as { synthesisInstruction?: string }).synthesisInstruction || "")}`
        : "",
    ].filter(Boolean),
  };
}

function extractNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").replace(/[^\d.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function keyMetricsNumbersMatch(original: KeyMetric[], candidate: KeyMetric[]) {
  if (!Array.isArray(candidate) || candidate.length !== original.length) return false;
  for (let i = 0; i < original.length; i++) {
    const a = extractNumericValue(original[i]?.value);
    const b = extractNumericValue(candidate[i]?.value);
    if (a != null && b != null && a !== b) return false;
    if (a != null && b == null) return false;
  }
  return true;
}

type AiNarration = {
  directAnswer?: string;
  executiveSummary?: string;
  insights?: string[];
  recommendations?: string[];
  keyMetrics?: KeyMetric[];
};

export async function narrateWithOpenAi(
  deterministic: DeterministicAnswer,
  context: NarrationContext,
): Promise<{ answer: DeterministicAnswer; aiConnected: boolean }> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return { answer: { ...deterministic, isAiGenerated: false }, aiConnected: false };
  }

  const payload = buildNarrationPayload(deterministic, context);
  const systemPrompt =
    "You are Ask NAC, a restaurant operations analyst. Improve clarity of verified facts. Return JSON only with keys: directAnswer, executiveSummary (optional), insights, recommendations. Do not include keyMetrics, sources, warnings, missingData, or vaultSources. Never describe a requested end date as included when coverage says it is missing. Prefer 'through {availableEnd}' wording.";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        answer: {
          ...deterministic,
          isAiGenerated: false,
          warnings: [
            ...((deterministic.warnings as string[]) || []),
            `OpenAI narration failed (${res.status}) — showing verified facts only.${errText ? ` ${errText.slice(0, 120)}` : ""}`,
          ],
        },
        aiConnected: false,
      };
    }

    const body = await res.json();
    const raw = body?.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      return {
        answer: {
          ...deterministic,
          isAiGenerated: false,
          warnings: [
            ...((deterministic.warnings as string[]) || []),
            "OpenAI returned empty narration — showing verified facts only.",
          ],
        },
        aiConnected: false,
      };
    }

    let parsed: AiNarration;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        answer: {
          ...deterministic,
          isAiGenerated: false,
          warnings: [
            ...((deterministic.warnings as string[]) || []),
            "OpenAI returned invalid JSON — showing verified facts only.",
          ],
        },
        aiConnected: false,
      };
    }

    if (parsed.keyMetrics && !keyMetricsNumbersMatch(
      (deterministic.keyMetrics as KeyMetric[]) || [],
      parsed.keyMetrics,
    )) {
      return {
        answer: {
          ...deterministic,
          isAiGenerated: false,
          warnings: [
            ...((deterministic.warnings as string[]) || []),
            "OpenAI attempted to change verified metric values — rejected narration.",
          ],
        },
        aiConnected: true,
      };
    }

    if (!parsed.directAnswer) {
      return { answer: { ...deterministic, isAiGenerated: false }, aiConnected: true };
    }

    const coercedDirectAnswer = coercePlainTextDirectAnswer(
      parsed.directAnswer,
      deterministic as { executiveBrief?: { executiveSummary?: string } },
    ) || coercePlainTextDirectAnswer(deterministic.directAnswer, deterministic as { executiveBrief?: { executiveSummary?: string } });

    if (!coercedDirectAnswer) {
      return { answer: { ...deterministic, isAiGenerated: false }, aiConnected: true };
    }

    const merged: DeterministicAnswer = {
      ...deterministic,
      directAnswer: coercedDirectAnswer,
      insights: parsed.insights?.length ? parsed.insights : (deterministic.insights as string[]) || [],
      recommendations: parsed.recommendations?.length
        ? parsed.recommendations
        : (deterministic.recommendations as string[]) || [],
      sources: deterministic.sources,
      warnings: deterministic.warnings,
      missingData: deterministic.missingData,
      vaultSources: deterministic.vaultSources,
      keyMetrics: deterministic.keyMetrics,
      isAiGenerated: true,
    };

    if (parsed.executiveSummary) {
      merged.executiveSummary = parsed.executiveSummary;
    }

    return { answer: merged, aiConnected: true };
  } catch (err) {
    return {
      answer: {
        ...deterministic,
        isAiGenerated: false,
        warnings: [
          ...((deterministic.warnings as string[]) || []),
          `OpenAI narration error — showing verified facts only. ${(err as Error)?.message || ""}`.trim(),
        ],
      },
      aiConnected: false,
    };
  }
}
