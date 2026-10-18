// LLM router — resolves the right provider for a given (tenant, use-case)
// with automatic fallback + cost/latency telemetry.
//
// Configuration lives on `TenantIntegration.secrets` for a provider row
// with `provider="LLMRouter"`:
//
//   {
//     defaultProvider: "anthropic",
//     routes: {
//       "invoice.extract":   { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
//       "ticket.triage":     { provider: "openai",    model: "gpt-4o-mini" },
//       "campaign.write":    { provider: "openai",    model: "gpt-4o" },
//       "airgapped":         { provider: "ollama",    model: "llama3.3:70b" }
//     },
//     fallback: ["anthropic", "openai", "stub"],
//     providers: {
//       anthropic: { apiKey: "...", defaultModel: "..." },
//       openai:    { apiKey: "..." },
//       ollama:    { baseUrl: "http://ollama:11434" }
//     }
//   }
//
// Callers pass a `useCase` key (free-form, e.g. "invoice.extract") and
// the router picks the provider. If the primary fails, walks the
// fallback chain in order.

import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";
import {
  LLMCallError,
  llmProviderFromSecrets,
  type ProviderSecrets,
} from "./llm-providers";

export interface RouteSpec {
  provider: ProviderSecrets["provider"];
  model?: string;
}

export interface LLMRouterConfig {
  defaultProvider: ProviderSecrets["provider"];
  routes?: Record<string, RouteSpec>;
  fallback?: ProviderSecrets["provider"][];
  providers?: Partial<Record<ProviderSecrets["provider"], Omit<ProviderSecrets, "provider">>>;
}

export interface TelemetrySink {
  record(evt: {
    tenantId: string;
    useCase: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    success: boolean;
    error?: string;
  }): Promise<void>;
}

const noopTelemetry: TelemetrySink = {
  async record() {
    // no-op
  },
};

export class LLMRouter {
  constructor(
    private readonly config: LLMRouterConfig,
    private readonly telemetry: TelemetrySink = noopTelemetry,
    private readonly tenantId: string = "",
  ) {}

  // Resolve the ordered provider chain for a use-case: [primary, ...fallbacks].
  // Every entry produces a concrete LLMProvider via the factory.
  protected chainFor(useCase: string): Array<{ provider: LLMProvider; secrets: ProviderSecrets }> {
    const primary = this.config.routes?.[useCase] ?? {
      provider: this.config.defaultProvider,
    };
    const chain: Array<{ provider: LLMProvider; secrets: ProviderSecrets }> = [];
    const seen = new Set<string>();

    const push = (spec: RouteSpec): void => {
      const bag = this.config.providers?.[spec.provider] ?? {};
      const secrets: ProviderSecrets = {
        provider: spec.provider,
        apiKey: bag.apiKey,
        baseUrl: bag.baseUrl,
        defaultModel: spec.model ?? bag.defaultModel,
      };
      const key = `${secrets.provider}::${secrets.defaultModel ?? "default"}`;
      if (seen.has(key)) return;
      seen.add(key);
      try {
        chain.push({ provider: llmProviderFromSecrets(secrets), secrets });
      } catch {
        // silently drop — a bad config entry shouldn't kill the chain
      }
    };

    push(primary);
    for (const fallbackProvider of this.config.fallback ?? []) {
      push({ provider: fallbackProvider });
    }
    return chain;
  }

  async call<T>(useCase: string, input: LLMCallInput): Promise<LLMCallResult<T>> {
    const chain = this.chainFor(useCase);
    if (chain.length === 0) {
      throw new LLMCallError("No provider configured for router", "router");
    }
    const errors: string[] = [];
    for (const { provider } of chain) {
      const started = Date.now();
      try {
        const result = await provider.call<T>(input);
        await this.telemetry.record({
          tenantId: this.tenantId,
          useCase,
          provider: result.provider,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          success: true,
        });
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${provider.name}: ${msg}`);
        await this.telemetry.record({
          tenantId: this.tenantId,
          useCase,
          provider: provider.name,
          model: input.model ?? "",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - started,
          success: false,
          error: msg,
        });
        // continue to next fallback
      }
    }
    throw new LLMCallError(
      `All providers failed for ${useCase}: ${errors.join(" | ")}`,
      "router",
    );
  }
}

// Convenience: load the router from a decrypted secrets bag.
export function routerFromSecrets(
  secrets: Record<string, unknown>,
  tenantId: string,
  telemetry?: TelemetrySink,
): LLMRouter {
  const cfg: LLMRouterConfig = {
    defaultProvider: (secrets.defaultProvider as ProviderSecrets["provider"]) ?? "stub",
    routes: (secrets.routes as Record<string, RouteSpec>) ?? {},
    fallback: (secrets.fallback as ProviderSecrets["provider"][]) ?? [],
    providers:
      (secrets.providers as LLMRouterConfig["providers"]) ??
      undefined,
  };
  return new LLMRouter(cfg, telemetry, tenantId);
}
