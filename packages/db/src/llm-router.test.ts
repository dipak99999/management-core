import { describe, expect, it, vi } from "vitest";
import { LLMRouter, routerFromSecrets, type TelemetrySink } from "./llm-router";
import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";

function mockProvider(name: string, behavior: "ok" | "fail"): LLMProvider {
  return {
    name,
    async call<T>(_input: LLMCallInput): Promise<LLMCallResult<T>> {
      if (behavior === "fail") throw new Error(`${name}: boom`);
      return {
        parsed: { from: name } as T,
        raw: JSON.stringify({ from: name }),
        provider: name,
        model: "mock",
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 42,
      };
    },
  };
}

// Test double: subclass overrides `chainFor` to swap real factory
// with a fixed list of pre-built mock providers.
function makeRouter(order: Array<{ name: string; behavior: "ok" | "fail" }>) {
  const providers = order.map((o) => ({
    provider: mockProvider(o.name, o.behavior),
    secrets: { provider: o.name as "anthropic" },
  }));
  class TestRouter extends LLMRouter {
    protected override chainFor() {
      return providers;
    }
  }
  return new TestRouter({ defaultProvider: "stub" }, undefined, "tenant-A");
}

describe("LLMRouter", () => {
  it("hits the primary provider on success", async () => {
    const r = makeRouter([{ name: "anthropic", behavior: "ok" }]);
    const out = await r.call<{ from: string }>("test", {
      system: "s",
      user: "u",
      responseSchema: {},
    });
    expect(out.parsed.from).toBe("anthropic");
    expect(out.provider).toBe("anthropic");
  });

  it("falls back to the next provider on primary failure", async () => {
    const r = makeRouter([
      { name: "anthropic", behavior: "fail" },
      { name: "openai", behavior: "ok" },
    ]);
    const out = await r.call<{ from: string }>("test", {
      system: "s",
      user: "u",
      responseSchema: {},
    });
    expect(out.parsed.from).toBe("openai");
  });

  it("throws when every provider in the chain fails", async () => {
    const r = makeRouter([
      { name: "anthropic", behavior: "fail" },
      { name: "openai", behavior: "fail" },
    ]);
    await expect(
      r.call("test", { system: "s", user: "u", responseSchema: {} }),
    ).rejects.toThrow(/All providers failed/);
  });

  it("records telemetry per attempt (success + failure)", async () => {
    const events: unknown[] = [];
    const sink: TelemetrySink = { async record(e) { events.push(e); } };
    const providers = new Map([
      ["anthropic", mockProvider("anthropic", "fail")],
      ["openai", mockProvider("openai", "ok")],
    ]);
    class TestRouter extends LLMRouter {
      protected override chainFor(_uc: string) {
        return [
          { provider: providers.get("anthropic")!, secrets: { provider: "anthropic" as never } },
          { provider: providers.get("openai")!, secrets: { provider: "openai" as never } },
        ];
      }
    }
    const r = new TestRouter({ defaultProvider: "stub" }, sink, "tenant-A");
    await r.call("uc", { system: "s", user: "u", responseSchema: {} });
    expect(events).toHaveLength(2);
    expect((events[0] as { success: boolean }).success).toBe(false);
    expect((events[1] as { success: boolean }).success).toBe(true);
  });
});

describe("routerFromSecrets", () => {
  it("resolves to a stub router when defaultProvider is stub", () => {
    const r = routerFromSecrets({ defaultProvider: "stub" }, "t1");
    expect(r).toBeInstanceOf(LLMRouter);
  });

  it("accepts full route + fallback config", () => {
    const r = routerFromSecrets(
      {
        defaultProvider: "anthropic",
        routes: { "invoice.extract": { provider: "openai", model: "gpt-4o-mini" } },
        fallback: ["ollama", "stub"],
        providers: { anthropic: { apiKey: "sk-a" }, openai: { apiKey: "sk-o" } },
      },
      "t1",
    );
    expect(r).toBeInstanceOf(LLMRouter);
  });
});
