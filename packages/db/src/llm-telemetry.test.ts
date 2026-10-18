import { describe, expect, it, vi } from "vitest";
import {
  chainTelemetry,
  estimateCostUsd,
  makeLoggerTelemetry,
  makeOtelTelemetry,
} from "./llm-telemetry";

describe("estimateCostUsd", () => {
  it("prices Claude Haiku correctly (1 + 5 per Mtoken)", () => {
    // 100k input + 50k output → 0.1 + 0.25 = $0.35
    const c = estimateCostUsd("anthropic", "claude-haiku-4-5-20251001", 100_000, 50_000);
    expect(c).toBeCloseTo(0.35, 6);
  });

  it("returns 0 for unknown model", () => {
    expect(estimateCostUsd("unknown", "unknown", 1000, 1000)).toBe(0);
  });

  it("returns 0 for ollama (wildcard match)", () => {
    expect(estimateCostUsd("ollama", "llama3.3:70b", 100_000, 100_000)).toBe(0);
  });
});

describe("makeLoggerTelemetry", () => {
  it("logs one JSON entry per call", async () => {
    const calls: unknown[] = [];
    const sink = makeLoggerTelemetry({
      info(msg, ctx) { calls.push({ msg, ctx }); },
    });
    await sink.record({
      tenantId: "t1",
      useCase: "test",
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      latencyMs: 200,
      success: true,
    });
    expect(calls).toHaveLength(1);
    const c = calls[0] as { msg: string; ctx: { costUsd: number; provider: string } };
    expect(c.msg).toBe("llm.call");
    expect(c.ctx.provider).toBe("openai");
    expect(c.ctx.costUsd).toBeGreaterThan(0);
  });
});

describe("chainTelemetry", () => {
  it("fans out to every sink", async () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const chained = chainTelemetry(
      { async record(e) { a.push(e); } },
      { async record(e) { b.push(e); } },
    );
    await chained.record({
      tenantId: "t", useCase: "u", provider: "p", model: "m",
      inputTokens: 0, outputTokens: 0, latencyMs: 0, success: true,
    });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("keeps going when one sink throws", async () => {
    const good: unknown[] = [];
    const chained = chainTelemetry(
      { async record() { throw new Error("boom"); } },
      { async record(e) { good.push(e); } },
    );
    await chained.record({
      tenantId: "t", useCase: "u", provider: "p", model: "m",
      inputTokens: 0, outputTokens: 0, latencyMs: 0, success: true,
    });
    expect(good).toHaveLength(1);
  });
});

describe("makeOtelTelemetry", () => {
  it("returns a working no-op sink when OTEL API is unavailable", async () => {
    const sink = makeOtelTelemetry();
    await expect(
      sink.record({
        tenantId: "t", useCase: "u", provider: "p", model: "m",
        inputTokens: 10, outputTokens: 5, latencyMs: 1, success: true,
      }),
    ).resolves.toBeUndefined();
  });
});
