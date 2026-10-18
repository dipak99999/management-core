// MUST be the first import — side-effect sets DATABASE_URL to
// lumaara_test BEFORE @prisma/client (via ./index) caches the dev URL.
// Without this, the deleteMany() calls below wipe operators' dev DB.
import "./test-db-url";
process.env.MASTER_SECRET_KEY = "a".repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChatProviderFromSecrets,
  NoChatProviderError,
  resolveChatProvider,
} from "./ai-chat-resolver";
import { encryptSecrets } from "./secrets-crypto";
import { prisma } from "./index";

// These tests focus on the resolver's chain-walking logic + the concrete
// provider classes' request shapes. We mock global `fetch` so no network
// calls hit real APIs.

const originalFetch = globalThis.fetch;

function mockFetch(impl: typeof fetch): void {
  globalThis.fetch = impl as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

async function cleanup(tenantId: string): Promise<void> {
  await prisma.tenantIntegration
    .deleteMany({ where: { tenantId } })
    .catch(() => void 0);
  await prisma.platformAiProvider.deleteMany({}).catch(() => void 0);
}

describe("buildChatProviderFromSecrets", () => {
  afterEach(() => restoreFetch());

  it("builds an anthropic provider with the right call shape", async () => {
    const captured: { url?: string; body?: unknown } = {};
    mockFetch(async (url, init) => {
      captured.url = String(url);
      captured.body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hi back" }],
          model: "claude-3-5-haiku-20241022",
          usage: { input_tokens: 10, output_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const p = buildChatProviderFromSecrets({
      provider: "anthropic",
      apiKey: "sk-ant-xxx",
    });
    const r = await p.chat("sys", [{ role: "user", content: "hi" }]);
    expect(r.text).toBe("hi back");
    expect(r.provider).toBe("anthropic");
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(3);
    expect(captured.url).toContain("/v1/messages");
    expect(captured.body).toMatchObject({
      model: "claude-3-5-haiku-20241022",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("builds an openai provider using chat/completions wire format", async () => {
    const captured: { url?: string; body?: unknown } = {};
    mockFetch(async (url, init) => {
      captured.url = String(url);
      captured.body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi back" } }],
          model: "gpt-4o-mini",
          usage: { prompt_tokens: 8, completion_tokens: 2 },
        }),
        { status: 200 },
      );
    });
    const p = buildChatProviderFromSecrets({
      provider: "openai",
      apiKey: "sk-xxx",
    });
    const r = await p.chat("sys", [{ role: "user", content: "hi" }]);
    expect(r.text).toBe("hi back");
    expect(r.provider).toBe("openai");
    expect(captured.url).toContain("/chat/completions");
    expect(captured.body).toMatchObject({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    });
  });

  it("brew uses OpenAI-compat shape with its own baseUrl", async () => {
    const captured: { url?: string } = {};
    mockFetch(async (url) => {
      captured.url = String(url);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      );
    });
    const p = buildChatProviderFromSecrets({
      provider: "brew",
      apiKey: "brew_tok",
      baseUrl: "https://brew.example/v1",
    });
    await p.chat("sys", [{ role: "user", content: "hi" }]);
    expect(captured.url).toBe("https://brew.example/v1/chat/completions");
    expect(p.kind).toBe("brew");
  });

  it("surfaces upstream HTTP errors with status in the message", async () => {
    mockFetch(async () =>
      new Response("Unauthorized", { status: 401 }),
    );
    const p = buildChatProviderFromSecrets({
      provider: "anthropic",
      apiKey: "bad",
    });
    await expect(
      p.chat("s", [{ role: "user", content: "x" }]),
    ).rejects.toThrow(/Anthropic 401/);
  });

  it("throws NoChatProviderError when brew is missing baseUrl", () => {
    expect(() =>
      buildChatProviderFromSecrets({
        provider: "brew",
        apiKey: "k",
      }),
    ).toThrow(NoChatProviderError);
  });
});

describe("resolveChatProvider — resolution chain", () => {
  // Dedicated test tenant — created in beforeAll so this suite doesn't
  // need the demo tenant to pre-exist in lumaara_test. Fresh ID so
  // concurrent runs of this file + other suites don't collide.
  const tenantId = `test-resolver-${Date.now().toString(36)}`;
  beforeAll(async () => {
    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: {},
      create: { id: tenantId, slug: `resolver-test-${tenantId.slice(-6)}`, name: "Resolver Test Tenant" },
    });
  });
  beforeEach(async () => cleanup(tenantId));
  afterEach(async () => {
    restoreFetch();
    await cleanup(tenantId);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("prefers tenant integration over platform fallback", async () => {
    await prisma.tenantIntegration.create({
      data: {
        tenantId,
        provider: "anthropic",
        name: "test-tenant-key",
        isActive: true,
        isDefault: true,
        secrets: encryptSecrets({ apiKey: "tenant-key-xxx" }) as never,
      },
    });
    await prisma.platformAiProvider.create({
      data: {
        provider: "openai",
        label: "platform-fallback",
        isActive: true,
        isDefault: true,
        secrets: encryptSecrets({ apiKey: "platform-key" }) as never,
      },
    });
    const p = await resolveChatProvider(tenantId);
    expect(p.kind).toBe("anthropic"); // tenant wins
  });

  it("falls back to platform default when tenant has no integration", async () => {
    await prisma.platformAiProvider.create({
      data: {
        provider: "openai",
        label: "platform-default",
        isActive: true,
        isDefault: true,
        secrets: encryptSecrets({ apiKey: "platform-key" }) as never,
      },
    });
    const p = await resolveChatProvider(tenantId);
    expect(p.kind).toBe("openai");
  });

  it("falls back to env ANTHROPIC_API_KEY in dev when nothing else is set", async () => {
    process.env.ANTHROPIC_API_KEY = "env-anthropic-key";
    const p = await resolveChatProvider(tenantId);
    expect(p.kind).toBe("anthropic");
  });

  it("throws NoChatProviderError when no source has a usable key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await expect(resolveChatProvider(tenantId)).rejects.toThrow(
      NoChatProviderError,
    );
  });

  it("skips inactive platform providers", async () => {
    await prisma.platformAiProvider.create({
      data: {
        provider: "anthropic",
        label: "disabled",
        isActive: false,
        isDefault: true,
        secrets: encryptSecrets({ apiKey: "disabled-key" }) as never,
      },
    });
    await prisma.platformAiProvider.create({
      data: {
        provider: "openai",
        label: "active-fallback",
        isActive: true,
        isDefault: false,
        priority: 50,
        secrets: encryptSecrets({ apiKey: "active-key" }) as never,
      },
    });
    const p = await resolveChatProvider(tenantId);
    expect(p.kind).toBe("openai"); // skipped the disabled one
  });

  it("picks platform providers in priority order when no default is set", async () => {
    await prisma.platformAiProvider.create({
      data: {
        provider: "anthropic",
        label: "lower-priority",
        isActive: true,
        priority: 500,
        secrets: encryptSecrets({ apiKey: "lower" }) as never,
      },
    });
    await prisma.platformAiProvider.create({
      data: {
        provider: "openai",
        label: "higher-priority",
        isActive: true,
        priority: 10,
        secrets: encryptSecrets({ apiKey: "higher" }) as never,
      },
    });
    const p = await resolveChatProvider(tenantId);
    expect(p.kind).toBe("openai"); // lower priority number = tried first
  });
});
