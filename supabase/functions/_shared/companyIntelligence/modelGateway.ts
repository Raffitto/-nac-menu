/**
 * Provider-neutral Model Gateway.
 * Business logic must not hard-depend on a single vendor model name.
 */

export type ModelRole =
  | "classify"
  | "plan"
  | "reason"
  | "synthesize"
  | "extract"
  | "critique";

export type ModelProviderId = "openai" | "openai_compatible_local" | "anthropic" | "gemini" | "none";

export type ModelGatewayConfig = {
  fastProvider: ModelProviderId;
  reasonProvider: ModelProviderId;
  synthesizeProvider: ModelProviderId;
  cloudEnabled: boolean;
  maxPaidCallsPerAnswer: number;
  localBaseUrl?: string | null;
  localModel?: string | null;
  openaiModel?: string | null;
};

export type ModelRequest = {
  role: ModelRole;
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
};

export type ModelResponse = {
  ok: boolean;
  provider: ModelProviderId;
  model: string | null;
  content: string | null;
  paid: boolean;
  error?: string | null;
  usage?: { promptTokens?: number; completionTokens?: number } | null;
};

export interface ModelAdapter {
  id: ModelProviderId;
  supports(role: ModelRole): boolean;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

function envGet(key: string): string | undefined {
  try {
    return typeof Deno !== "undefined" ? Deno.env.get(key) : undefined;
  } catch {
    return undefined;
  }
}

export function loadModelGatewayConfig(): ModelGatewayConfig {
  return {
    fastProvider: (envGet("MODEL_GATEWAY_FAST_PROVIDER") as ModelProviderId) || "openai",
    reasonProvider: (envGet("MODEL_GATEWAY_REASON_PROVIDER") as ModelProviderId) || "openai",
    synthesizeProvider: (envGet("MODEL_GATEWAY_SYNTHESIZE_PROVIDER") as ModelProviderId) || "openai",
    cloudEnabled: envGet("MODEL_GATEWAY_CLOUD_ENABLED") !== "false",
    maxPaidCallsPerAnswer: Number(envGet("MODEL_GATEWAY_MAX_PAID_CALLS") || 2),
    localBaseUrl: envGet("MODEL_GATEWAY_LOCAL_BASE_URL") || "http://127.0.0.1:11434/v1",
    localModel: envGet("MODEL_GATEWAY_LOCAL_MODEL") || "local-reasoner",
    openaiModel: envGet("OPENAI_MODEL") || "gpt-4o-mini",
  };
}

export function createOpenAiAdapter(model = "gpt-4o-mini"): ModelAdapter {
  return {
    id: "openai",
    supports() {
      return true;
    },
    async complete(req) {
      const apiKey = envGet("OPENAI_API_KEY");
      if (!apiKey) {
        return {
          ok: false,
          provider: "openai",
          model,
          content: null,
          paid: true,
          error: "missing_api_key",
        };
      }
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: req.temperature ?? 0.1,
            max_tokens: req.maxTokens ?? 500,
            response_format: req.json ? { type: "json_object" } : undefined,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
          }),
        });
        if (!res.ok) {
          return {
            ok: false,
            provider: "openai",
            model,
            content: null,
            paid: true,
            error: `http_${res.status}`,
          };
        }
        const json = await res.json();
        return {
          ok: true,
          provider: "openai",
          model,
          content: json?.choices?.[0]?.message?.content || null,
          paid: true,
          usage: {
            promptTokens: json?.usage?.prompt_tokens,
            completionTokens: json?.usage?.completion_tokens,
          },
        };
      } catch (err) {
        return {
          ok: false,
          provider: "openai",
          model,
          content: null,
          paid: true,
          error: String((err as Error)?.message || err),
        };
      }
    },
  };
}

/** OpenAI-compatible local endpoint (Ollama / MLX server / vLLM / company GPU). */
export function createOpenAiCompatibleLocalAdapter(options: {
  baseUrl?: string | null;
  model?: string | null;
} = {}): ModelAdapter {
  const baseUrl = (options.baseUrl || "http://127.0.0.1:11434/v1").replace(/\/$/, "");
  const model = options.model || "local-reasoner";
  return {
    id: "openai_compatible_local",
    supports() {
      return true;
    },
    async complete(req) {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: req.temperature ?? 0.1,
            max_tokens: req.maxTokens ?? 500,
            response_format: req.json ? { type: "json_object" } : undefined,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
          }),
        });
        if (!res.ok) {
          return {
            ok: false,
            provider: "openai_compatible_local",
            model,
            content: null,
            paid: false,
            error: `http_${res.status}`,
          };
        }
        const json = await res.json();
        return {
          ok: true,
          provider: "openai_compatible_local",
          model,
          content: json?.choices?.[0]?.message?.content || null,
          paid: false,
          usage: {
            promptTokens: json?.usage?.prompt_tokens,
            completionTokens: json?.usage?.completion_tokens,
          },
        };
      } catch (err) {
        return {
          ok: false,
          provider: "openai_compatible_local",
          model,
          content: null,
          paid: false,
          error: String((err as Error)?.message || err),
        };
      }
    },
  };
}

export type ModelGateway = {
  config: ModelGatewayConfig;
  paidCallsUsed: number;
  classify(req: Omit<ModelRequest, "role">): Promise<ModelResponse>;
  plan(req: Omit<ModelRequest, "role">): Promise<ModelResponse>;
  reason(req: Omit<ModelRequest, "role">): Promise<ModelResponse>;
  synthesize(req: Omit<ModelRequest, "role">): Promise<ModelResponse>;
  extract(req: Omit<ModelRequest, "role">): Promise<ModelResponse>;
  critique(req: Omit<ModelRequest, "role">): Promise<ModelResponse>;
};

function providerForRole(config: ModelGatewayConfig, role: ModelRole): ModelProviderId {
  if (role === "reason" || role === "critique") return config.reasonProvider;
  if (role === "synthesize") return config.synthesizeProvider;
  return config.fastProvider;
}

export function createModelGateway(
  adapters: Partial<Record<ModelProviderId, ModelAdapter>> = {},
  config: ModelGatewayConfig = loadModelGatewayConfig(),
): ModelGateway {
  const registry: Partial<Record<ModelProviderId, ModelAdapter>> = {
    openai: adapters.openai || createOpenAiAdapter(config.openaiModel || "gpt-4o-mini"),
    openai_compatible_local: adapters.openai_compatible_local
      || createOpenAiCompatibleLocalAdapter({
        baseUrl: config.localBaseUrl,
        model: config.localModel,
      }),
    ...adapters,
  };

  let paidCallsUsed = 0;

  async function run(role: ModelRole, req: Omit<ModelRequest, "role">): Promise<ModelResponse> {
    const preferred = providerForRole(config, role);
    const order: ModelProviderId[] = [preferred];
    if (preferred !== "openai_compatible_local") order.push("openai_compatible_local");
    if (preferred !== "openai" && config.cloudEnabled) order.push("openai");

    for (const providerId of order) {
      if (providerId === "openai" || providerId === "anthropic" || providerId === "gemini") {
        if (!config.cloudEnabled) continue;
        if (paidCallsUsed >= config.maxPaidCallsPerAnswer) {
          return {
            ok: false,
            provider: providerId,
            model: null,
            content: null,
            paid: true,
            error: "paid_call_budget_exhausted",
          };
        }
      }

      const adapter = registry[providerId];
      if (!adapter) continue;
      const result = await adapter.complete({ ...req, role });
      if (result.paid && result.ok) paidCallsUsed += 1;
      if (result.ok) return result;
      // local failure → try next; cloud failure → stop if no fallback
    }

    return {
      ok: false,
      provider: preferred,
      model: null,
      content: null,
      paid: false,
      error: "all_providers_failed",
    };
  }

  return {
    config,
    get paidCallsUsed() {
      return paidCallsUsed;
    },
    classify: (req) => run("classify", req),
    plan: (req) => run("plan", req),
    reason: (req) => run("reason", req),
    synthesize: (req) => run("synthesize", req),
    extract: (req) => run("extract", req),
    critique: (req) => run("critique", req),
  };
}
