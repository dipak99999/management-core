// Unit tests for the ai-assist router — Anthropic SDK is mocked at the
// module boundary so nothing here touches the real API.
//
// Coverage (per plan):
//   • No API key configured → 400 with helpful error
//   • subject-line happy path (mocked to return JSON array) → returns array
//   • write-email malformed model output → falls back to first-line + rest
//   • rewrite tone=casual passes correct system prompt (cache-controlled)
//   • Rate limit: 31st call in a minute → 429
//   • cache_control block present in the request payload
//
// Approach: we spy on a `mockCreate` function that the mocked Anthropic
// module returns from `client.messages.create()`. Each test can override the
// resolved value + then inspect `mockCreate.mock.calls[0][0]` for asserts on
// the request payload (model, max_tokens, system blocks with cache_control,
// etc). @lumaara/db is mocked so we don't touch Prisma. @lumaara/queue is
// partially mocked so rate-limit tests can force the true/false path.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Anthropic SDK mock --------------------------------------------

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  // The router builds a client via `new Anthropic({apiKey, timeout})` and
  // calls `client.messages.create(...)`. A minimal class-shaped mock is
  // enough — we only need `.messages.create`.
  class MockAnthropic {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(public opts: Record<string, any>) {}
    messages = {
      create: mockCreate,
    };
  }
  return { default: MockAnthropic };
});

// ---------- @lumaara/queue takeToken mock ---------------------------------
//
// Router calls `takeToken('ai:${tenantId}', 30)` at the top of every
// endpoint. Default = allow; tests can force `false` for the 429 path.

const mockTakeToken = vi.fn().mockResolvedValue(true);
vi.mock("@lumaara/queue", () => ({
  takeToken: (...args: unknown[]) => mockTakeToken(...args),
}));

// ---------- @lumaara/service-auth mock -------------------------------------
//
// Router imports requireAuth + getLogger. Middleware installed via
// requireAuth injects a fake auth object (mounted with app.use(requireAuth)
// in test harness below).

vi.mock("@lumaara/service-auth", () => {
  const requireAuth = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: TENANT_ID,
      userId: "user-U",
    };
    next();
  };
  return {
    requireAuth,
    getLogger: () => ({
      child: () => ({
        info: () => {},
        warn: () => {},
        debug: () => {},
        error: () => {},
      }),
    }),
  };
});

// ---------- @lumaara/db mock ----------------------------------------------
//
// We re-import the REAL ai-assist helpers (buildSystemBlocks, prompts,
// parseStringArray, sanitizeHtml, etc.) but mock the Prisma-touching
// entry points (resolveAnthropicApiKey, loadBrandContext, getAnthropicClient).
// This gives the router a real prompt shape while keeping tests hermetic.

let apiKeyResolver: () => Promise<string | null> = async () => "sk-ant-test";

vi.mock("@lumaara/db", async () => {
  const real = await vi.importActual<typeof import("../../../../packages/db/src/ai-assist")>(
    "../../../../packages/db/src/ai-assist",
  );
  // Grab the real Anthropic mock class for getAnthropicClient() to return
  // an instance of.
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  class NoApiKeyErrorLocal extends Error {
    constructor() {
      super("AI features require an Anthropic API key. Configure in Admin → Integrations.");
      this.name = "NoApiKeyError";
    }
  }

  return {
    MODEL_HAIKU: real.MODEL_HAIKU,
    MODEL_SONNET: real.MODEL_SONNET,
    REQUEST_TIMEOUT_MS: real.REQUEST_TIMEOUT_MS,
    NoApiKeyError: NoApiKeyErrorLocal,
    SOCIAL_CHAR_LIMITS: real.SOCIAL_CHAR_LIMITS,
    buildSystemBlocks: real.buildSystemBlocks,
    buildSystemPrompt: real.buildSystemPrompt,
    parseStringArray: real.parseStringArray,
    extractText: real.extractText,
    sanitizeHtml: real.sanitizeHtml,
    subjectLinePrompt: real.subjectLinePrompt,
    writeEmailPrompt: real.writeEmailPrompt,
    rewritePrompt: real.rewritePrompt,
    summarizePrompt: real.summarizePrompt,
    socialCaptionPrompt: real.socialCaptionPrompt,
    loadBrandContext: async () => null, // no BrandKit in tests
    resolveAnthropicApiKey: async () => apiKeyResolver(),
    getAnthropicClient: async () => {
      const key = await apiKeyResolver();
      if (!key) throw new NoApiKeyErrorLocal();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new (Anthropic as any)({ apiKey: key, timeout: 30_000 });
    },
  };
});

// ---------- Constants + harness -------------------------------------------

const TENANT_ID = "tenant_abc";

async function makeApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const { aiAssistRouter } = await import("./ai-assist");
  const { requireAuth } = await import("@lumaara/service-auth");
  app.use("/ai-assist", requireAuth, aiAssistRouter);
  return app;
}

/** Convenience — build a valid Anthropic-shaped response with `text` content. */
function anthropicTextResponse(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text }] };
}

beforeEach(() => {
  mockCreate.mockReset();
  mockTakeToken.mockReset().mockResolvedValue(true);
  apiKeyResolver = async () => "sk-ant-test";
});

// ==========================================================================
// Health
// ==========================================================================

describe("GET /ai-assist/health", () => {
  it("returns ok", async () => {
    const app = await makeApp();
    const res = await request(app).get("/ai-assist/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, kind: "ai-assist" });
  });
});

// ==========================================================================
// No API key → 400
// ==========================================================================

describe("no API key configured", () => {
  it("returns 400 with helpful error on any AI endpoint", async () => {
    apiKeyResolver = async () => null;
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>Hello world</p>" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Anthropic API key");
    // Also assert the model was NOT called — no key means no request.
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// POST /subject-line — happy path
// ==========================================================================

describe("POST /ai-assist/subject-line", () => {
  it("returns the array parsed from a JSON model response", async () => {
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse('["Sub 1","Sub 2","Sub 3"]'),
    );
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>Fall sale</p>", count: 3, tone: "casual" });
    expect(res.status).toBe(200);
    expect(res.body.subjects).toEqual(["Sub 1", "Sub 2", "Sub 3"]);

    // Assert on the request payload sent to Anthropic:
    //   * model: haiku
    //   * max_tokens: 200
    //   * system: array with cache_control ephemeral
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0]![0] as {
      model: string;
      max_tokens: number;
      system: Array<{ type: string; text: string; cache_control: { type: string } }>;
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.model).toContain("haiku");
    expect(call.max_tokens).toBe(200);
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0]!.type).toBe("text");
    expect(call.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    // System text is the marketing-copywriter block.
    expect(call.system[0]!.text).toMatch(/marketing copywriter/i);
    // User prompt carries the body + tone.
    expect(call.messages[0]!.role).toBe("user");
    expect(call.messages[0]!.content).toContain("casual");
    expect(call.messages[0]!.content).toContain("Fall sale");
  });

  it("returns 502 when the model output has no usable subjects", async () => {
    // Return whitespace only — parseStringArray falls back to newline split,
    // which yields zero entries after trim/filter.
    mockCreate.mockResolvedValueOnce(anthropicTextResponse("   \n  \n  "));
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>x</p>" });
    expect(res.status).toBe(502);
  });

  it("rejects invalid tone with 400 zod error", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>x</p>", tone: "sarcastic" });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// POST /write-email — malformed output fallback
// ==========================================================================

describe("POST /ai-assist/write-email", () => {
  it("parses strict {subject, body} JSON output on the happy path", async () => {
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(
        '{"subject": "Fall savings inside","body": "<p>Enjoy 20% off.</p>"}',
      ),
    );
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/write-email")
      .send({ brief: "Announce 20% fall sale", length: "short" });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe("Fall savings inside");
    expect(res.body.body).toBe("<p>Enjoy 20% off.</p>");

    // Uses SONNET, not HAIKU.
    const call = mockCreate.mock.calls[0]![0] as { model: string; max_tokens: number };
    expect(call.model).toContain("sonnet");
    expect(call.max_tokens).toBe(2000);
  });

  it("falls back to first-line-as-subject when JSON parse fails", async () => {
    // Malformed output — no JSON object.
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse("Fall savings inside\n<p>Enjoy 20% off.</p>"),
    );
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/write-email")
      .send({ brief: "Announce sale" });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe("Fall savings inside");
    expect(res.body.body).toContain("Enjoy 20% off");
  });

  it("sanitizes <script> from generated body", async () => {
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(
        '{"subject":"Hi","body":"<p>Hello</p><script>alert(1)</script>"}',
      ),
    );
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/write-email")
      .send({ brief: "greet" });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe("<p>Hello</p>");
    expect(res.body.body).not.toContain("<script>");
  });
});

// ==========================================================================
// POST /rewrite — tone flows through into the user prompt + cache header
// ==========================================================================

describe("POST /ai-assist/rewrite", () => {
  it("passes the correct system prompt (cached) and user tone instruction", async () => {
    mockCreate.mockResolvedValueOnce(anthropicTextResponse("<p>casual rewrite</p>"));
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/rewrite")
      .send({ text: "<p>Please review our proposal at your earliest convenience.</p>", tone: "casual" });
    expect(res.status).toBe(200);
    expect(res.body.rewritten).toBe("<p>casual rewrite</p>");

    const call = mockCreate.mock.calls[0]![0] as {
      model: string;
      max_tokens: number;
      system: Array<{ type: string; text: string; cache_control: { type: string } }>;
      messages: Array<{ role: string; content: string }>;
    };
    // Model: haiku, max_tokens: 1500 per plan.
    expect(call.model).toContain("haiku");
    expect(call.max_tokens).toBe(1500);
    // Cache control present.
    expect(call.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    // Same canonical system prompt — so cache hits across endpoints.
    expect(call.system[0]!.text).toMatch(/marketing copywriter/i);
    // User prompt instructs casual rewrite.
    expect(call.messages[0]!.content).toMatch(/casual/i);
    expect(call.messages[0]!.content).toContain("earliest convenience");
  });

  it("rejects unknown tone with 400", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/rewrite")
      .send({ text: "x", tone: "sarcastic" });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// POST /summarize
// ==========================================================================

describe("POST /ai-assist/summarize", () => {
  it("trims to the requested word cap and strips HTML", async () => {
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse("<p>This is a <strong>five</strong> word answer</p>"),
    );
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/summarize")
      .send({ text: "long body", maxWords: 3 });
    expect(res.status).toBe(200);
    // 3 words, HTML stripped.
    expect(res.body.summary.split(" ")).toHaveLength(3);
    expect(res.body.summary).not.toContain("<");
  });
});

// ==========================================================================
// POST /social-caption — platform char-limit enforcement
// ==========================================================================

describe("POST /ai-assist/social-caption", () => {
  it("caps twitter captions at 280 chars even if model overshoots", async () => {
    const overshoot = "a".repeat(400);
    mockCreate.mockResolvedValueOnce(
      anthropicTextResponse(`["${overshoot}"]`),
    );
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/social-caption")
      .send({ context: "New product", platform: "twitter", count: 1 });
    expect(res.status).toBe(200);
    expect(res.body.captions).toHaveLength(1);
    expect(res.body.captions[0].length).toBeLessThanOrEqual(280);
  });
});

// ==========================================================================
// Rate limit — 31st call → 429
// ==========================================================================

describe("rate limit", () => {
  it("returns 429 when takeToken returns false", async () => {
    mockTakeToken.mockResolvedValueOnce(false);
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>x</p>" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/rate limit/i);
    // Model was NOT invoked — rate limit short-circuits before the SDK call.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("simulated 31st call — bucket exhausts, 429 returned", async () => {
    // Fake bucket that returns true 30 times, false thereafter.
    let count = 0;
    mockTakeToken.mockImplementation(async () => {
      count += 1;
      return count <= 30;
    });
    // Return the same OK payload for all successful calls.
    mockCreate.mockResolvedValue(anthropicTextResponse('["A","B"]'));

    const app = await makeApp();
    // Fire 30 successful calls.
    for (let i = 0; i < 30; i += 1) {
      const r = await request(app)
        .post("/ai-assist/subject-line")
        .send({ bodyHtml: "<p>x</p>", count: 2 });
      expect(r.status).toBe(200);
    }
    // 31st should 429.
    const r = await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>x</p>", count: 2 });
    expect(r.status).toBe(429);
  });
});

// ==========================================================================
// cache_control payload assertion
// ==========================================================================

describe("prompt caching", () => {
  it("sends system as an array-of-blocks with cache_control ephemeral", async () => {
    mockCreate.mockResolvedValueOnce(anthropicTextResponse('["a"]'));
    const app = await makeApp();
    await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>x</p>" });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0]![0] as {
      system: unknown;
    };
    expect(Array.isArray(payload.system)).toBe(true);
    const blocks = payload.system as Array<Record<string, unknown>>;
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]!.type).toBe("text");
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(typeof blocks[0]!.text).toBe("string");
    expect((blocks[0]!.text as string).length).toBeGreaterThan(50);
  });
});

// ==========================================================================
// Upstream Anthropic error handling
// ==========================================================================

describe("upstream errors", () => {
  it("maps Anthropic 401 to 400 with 'Update it in Admin' hint", async () => {
    const err = new Error("invalid api key") as Error & { status: number };
    err.status = 401;
    mockCreate.mockRejectedValueOnce(err);
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>x</p>" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Admin/i);
  });

  it("maps Anthropic 429 to 429", async () => {
    const err = new Error("upstream throttled") as Error & { status: number };
    err.status = 429;
    mockCreate.mockRejectedValueOnce(err);
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>x</p>" });
    expect(res.status).toBe(429);
  });

  it("maps arbitrary SDK error to 502", async () => {
    mockCreate.mockRejectedValueOnce(new Error("network down"));
    const app = await makeApp();
    const res = await request(app)
      .post("/ai-assist/subject-line")
      .send({ bodyHtml: "<p>x</p>" });
    expect(res.status).toBe(502);
  });
});
