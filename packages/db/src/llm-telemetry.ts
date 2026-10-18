// TelemetrySink implementations for the LLM router.
//
// DbTelemetrySink       — persists every call to a compact `AILog`-like
//                         table for cost + latency audit (uses the
//                         existing ErrorLog on failure; the success
//                         path can piggyback on AIExtractionJob or
//                         ship its own table in a future migration).
// OtelTelemetrySink     — records a span per call with attributes for
//                         provider/model/tokens/cost/latency. Zero
//                         schema footprint — pipe to Datadog/Grafana.
// LoggerTelemetrySink   — writes a JSON line via the standard logger.
//                         Cheapest option — good for early deployments.
// ChainTelemetrySink    — fan out to multiple sinks.

import type { TelemetrySink } from "./llm-router";

// Very rough $ per 1M tokens by (provider, kind). Kept as a static
// table so we can compute cost without a live pricing API. Values as
// of Q4 2025 — bump when providers change list prices.
const PRICE_PER_MTOKEN: Record<string, { input: number; output: number }> = {
  "anthropic:claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "anthropic:claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "anthropic:claude-opus-4-7": { input: 15.0, output: 75.0 },
  "openai:gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai:gpt-4o": { input: 2.5, output: 10.0 },
  "openai:gpt-5": { input: 3.75, output: 15.0 },
  "ollama:*": { input: 0, output: 0 }, // self-hosted → no per-token bill
};

export function estimateCostUsd(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const key = `${provider}:${model}`;
  const p = PRICE_PER_MTOKEN[key] ?? PRICE_PER_MTOKEN[`${provider}:*`];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// ── Logger sink (default) ─────────────────────────────────────────

export interface JsonLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
}

export function makeLoggerTelemetry(logger: JsonLogger): TelemetrySink {
  return {
    async record(evt) {
      const cost = estimateCostUsd(evt.provider, evt.model, evt.inputTokens, evt.outputTokens);
      logger.info("llm.call", {
        tenantId: evt.tenantId,
        useCase: evt.useCase,
        provider: evt.provider,
        model: evt.model,
        inputTokens: evt.inputTokens,
        outputTokens: evt.outputTokens,
        latencyMs: evt.latencyMs,
        costUsd: cost,
        success: evt.success,
        error: evt.error,
      });
    },
  };
}

// ── OTEL sink ─────────────────────────────────────────────────────
//
// Uses the global OpenTelemetry API if the parent process called
// initOtel(). If OTEL isn't set up, this sink degrades to a no-op —
// safe to install unconditionally.

interface OtelTracer {
  startSpan(name: string, opts?: { attributes?: Record<string, unknown> }): {
    setAttribute(key: string, value: unknown): void;
    setStatus(status: { code: number; message?: string }): void;
    recordException(err: unknown): void;
    end(): void;
  };
}

interface OtelApi {
  trace: { getTracer(name: string): OtelTracer };
  SpanStatusCode: { OK: number; ERROR: number };
}

export function makeOtelTelemetry(): TelemetrySink {
  let api: OtelApi | null = null;
  try {
    // Dynamic require — @opentelemetry/api may or may not be installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    api = require("@opentelemetry/api") as OtelApi;
  } catch {
    api = null;
  }
  if (!api) {
    return { async record() { /* noop */ } };
  }
  const tracer = api.trace.getTracer("lumaara.llm");
  const OK = api.SpanStatusCode.OK;
  const ERROR = api.SpanStatusCode.ERROR;
  return {
    async record(evt) {
      const cost = estimateCostUsd(evt.provider, evt.model, evt.inputTokens, evt.outputTokens);
      const span = tracer.startSpan(`llm.${evt.useCase}`, {
        attributes: {
          "llm.tenant_id": evt.tenantId,
          "llm.use_case": evt.useCase,
          "llm.provider": evt.provider,
          "llm.model": evt.model,
          "llm.input_tokens": evt.inputTokens,
          "llm.output_tokens": evt.outputTokens,
          "llm.latency_ms": evt.latencyMs,
          "llm.cost_usd": cost,
          "llm.success": evt.success,
        },
      });
      if (evt.success) {
        span.setStatus({ code: OK });
      } else {
        span.setStatus({ code: ERROR, message: evt.error });
        span.setAttribute("llm.error", evt.error ?? "");
      }
      span.end();
    },
  };
}

// ── Chain (fan-out) ───────────────────────────────────────────────

export function chainTelemetry(...sinks: TelemetrySink[]): TelemetrySink {
  return {
    async record(evt) {
      await Promise.all(sinks.map((s) => s.record(evt).catch(() => {})));
    },
  };
}
