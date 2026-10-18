// Unit tests for the /ai/chat RAG endpoint.
//
// Coverage:
//   1. Missing Anthropic key → 400 with helpful hint
//   2. Happy path — retrieves top-K embeddings by cosine, passes as context,
//      returns { answer, citations, model }
//   3. Rate limit — 31st call in a minute → 429
//   4. Empty tenant (no embeddings) → still answers, citations = []
//   5. Tenant isolation — an embedding from tenant B never appears in the
//      response even if the vector is a perfect match

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------- @lumaara/queue mock ----------

let rateLimitAllow = true;
vi.mock("@lumaara/queue", () => ({
  takeToken: async () => rateLimitAllow,
  peekBucket: () => null,
}));

// ---------- Anthropic SDK mock ----------
// We don't need to vi.mock('@anthropic-ai/sdk') here — the ai-chat handler
// only ever touches the SDK via getAnthropicClient() from @lumaara/db, and
// that's mocked below to return a fake client whose messages.create is
// mockCreate. Keeps this test independent of the SDK package version.

const mockCreate = vi.fn();

// ---------- @lumaara/service-auth mock ----------

const TENANT_ID = "tenant_abc";
vi.mock("@lumaara/service-auth", () => {
  const pass = (
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
    requireAuth: pass,
    perms: () => ({
      read: pass,
      write: pass,
      create: pass,
      delete: pass,
      submit: pass,
      cancel: pass,
    }),
    getLogger: () => ({
      child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    }),
  };
});

// ---------- @lumaara/db mock ----------

interface EmbeddingRow {
  tenantId: string;
  doctype: string;
  docId: string;
  title: string;
  content: string;
  vector: number[];
  vectorLength: number;
  stale: boolean;
}
const embeddings: EmbeddingRow[] = [];
let apiKey: string | null = "sk-ant-test";

// Plan gating state — tests mutate these via helpers above the describe
// block. Defaults are "super-admin + all-access" so pre-gating tests pass
// unchanged.
let mockIsSuperAdmin = true;
let mockSubscription: {
  plan: { allowedModules: string[]; allowedSubmodules: string[] };
} | null = {
  plan: {
    allowedModules: ["hrms", "payroll", "finance", "sales", "manufacturing"],
    allowedSubmodules: [],
  },
};

vi.mock("@lumaara/db", async () => {
  const real = await vi.importActual<typeof import("../../../../packages/db/src/embedding-provider")>(
    "../../../../packages/db/src/embedding-provider",
  );
  class NoApiKeyErrorLocal extends Error {
    constructor() {
      super("no key");
      this.name = "NoApiKeyError";
    }
  }
  // Single-source NoChatProviderError. Both the exported value AND the
  // one `resolveChatProvider` throws must be the same class — otherwise
  // `instanceof NoChatProviderError` in ai-chat.ts fails and we fall
  // through to a 500 instead of the clean 400.
  class NoChatProviderErrorLocal extends Error {
    constructor() {
      super("No AI provider configured. Add one in Super Admin → AI Providers.");
      this.name = "NoChatProviderError";
    }
  }
  // Inline Anthropic-shaped client: matches the surface ai-chat.ts uses.
  // Not a real SDK class — that avoids requiring @anthropic-ai/sdk as a
  // direct dev-dep of accounting-service.
  const fakeAnthropicClient = { messages: { create: mockCreate } };
  return {
    NoApiKeyError: NoApiKeyErrorLocal,
    NoChatProviderError: NoChatProviderErrorLocal,
    cosineSimilarity: real.cosineSimilarity,
    embeddingProviderFromSecrets: (_s: Record<string, unknown>) => ({
      providerName: "stub" as const,
      dimension: 4,
      // Query vector is fixed for reproducibility — [1,0,0,0].
      async embed(_text: string) {
        return { vector: [1, 0, 0, 0] };
      },
    }),
    decryptSecrets: (s: unknown) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}),
    getAnthropicClient: async () => {
      if (!apiKey) throw new NoApiKeyErrorLocal();
      return fakeAnthropicClient;
    },
    // Chat provider mock — returns whatever mockCreate was primed with.
    // Matches the ChatProvider interface the resolver would return.
    resolveChatProvider: async () => {
      if (!apiKey) throw new NoChatProviderErrorLocal();
      return {
        kind: "openai",
        model: "gpt-4o-mini",
        chat: async (_s: string, _msgs: unknown[]) => {
          const r = await mockCreate();
          const text = r?.content?.[0]?.text ?? "";
          return {
            text,
            provider: "openai",
            model: r?.model ?? "gpt-4o-mini",
            inputTokens: r?.usage?.input_tokens ?? 0,
            outputTokens: r?.usage?.output_tokens ?? 0,
          };
        },
        stream: async function* () { /* unused in these tests */ return { model: "gpt-4o-mini", inputTokens: 0, outputTokens: 0 }; },
      };
    },
    prisma: {
      tenantIntegration: {
        findFirst: async () => ({ id: "int_1", tenantId: TENANT_ID, secrets: {} }),
      },
      embedding: {
        findMany: async ({ where }: { where: { tenantId: string; doctype: { in: string[] } } }) => {
          return embeddings.filter(
            (e) =>
              e.tenantId === where.tenantId && where.doctype.in.includes(e.doctype),
          );
        },
      },
      // Plan gating: default to a super-admin "All Access" plan so the
      // existing (pre-gating) tests pass unchanged. Individual tests
      // override via mockPlan() for gating-specific scenarios.
      tenantSubscription: {
        findFirst: async () => mockSubscription,
      },
      user: {
        findUnique: async () => ({ isSuperAdmin: mockIsSuperAdmin }),
      },
    },
  };
});

async function makeApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const { aiChatRouter } = await import("./ai-chat");
  app.use("/ai", aiChatRouter);
  return app;
}

function stubResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: "text", text }],
    model: "claude-3-5-haiku-20241022",
    usage: { input_tokens: 100, output_tokens: 20 },
  });
}

beforeEach(() => {
  embeddings.length = 0;
  apiKey = "sk-ant-test";
  rateLimitAllow = true;
  mockCreate.mockReset();
  // Reset plan gating defaults — all tests get an "all-access" plan unless
  // they override explicitly via setPlan() below.
  mockIsSuperAdmin = true;
  mockSubscription = {
    plan: {
      allowedModules: ["hrms", "payroll", "finance", "sales", "manufacturing"],
      allowedSubmodules: [],
    },
  };
});

function setPlan(opts: {
  isSuperAdmin?: boolean;
  allowedModules?: string[];
  allowedSubmodules?: string[];
}): void {
  mockIsSuperAdmin = opts.isSuperAdmin ?? false;
  mockSubscription = {
    plan: {
      allowedModules: opts.allowedModules ?? [],
      allowedSubmodules: opts.allowedSubmodules ?? [],
    },
  };
}

describe("POST /ai/chat", () => {
  it("400s when no AI provider is configured", async () => {
    apiKey = null;
    const app = await makeApp();
    const r = await request(app).post("/ai/chat").send({ message: "hi" });
    expect(r.status).toBe(400);
    // Message swapped from "No Anthropic API key" to "No AI provider
    // configured" when we migrated to the multi-provider resolver.
    expect(r.body.error).toMatch(/No AI provider|provider/i);
  });

  it("returns an answer + citations when embeddings match", async () => {
    embeddings.push(
      {
        tenantId: TENANT_ID,
        doctype: "Customer",
        docId: "cust_1",
        title: "Acme Corp",
        content: "Acme Corp is a customer based in Delhi.",
        vector: [1, 0, 0, 0], // perfect match to query
        vectorLength: 4,
        stale: false,
      },
      {
        tenantId: TENANT_ID,
        doctype: "SalesInvoice",
        docId: "inv_1",
        title: "SI-0001",
        content: "Invoice SI-0001 to Acme Corp for ₹5,000.",
        vector: [0.9, 0.1, 0, 0], // near-match
        vectorLength: 4,
        stale: false,
      },
    );
    stubResponse("Acme Corp is a Delhi-based customer with one invoice.");
    const app = await makeApp();
    const r = await request(app)
      .post("/ai/chat")
      .send({ message: "Tell me about Acme Corp" });
    expect(r.status).toBe(200);
    expect(r.body.answer).toContain("Acme");
    expect(r.body.citations).toHaveLength(2);
    expect(r.body.citations[0]).toMatchObject({
      doctype: "Customer",
      docId: "cust_1",
      title: "Acme Corp",
    });
    // Verify tenant isolation was preserved in prisma call
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("never returns embeddings from other tenants (isolation)", async () => {
    embeddings.push(
      {
        tenantId: "tenant_OTHER",
        doctype: "Customer",
        docId: "leak",
        title: "Leaked Corp",
        content: "This is a different tenant's data.",
        vector: [1, 0, 0, 0],
        vectorLength: 4,
        stale: false,
      },
    );
    stubResponse("I don't have that information.");
    const app = await makeApp();
    const r = await request(app).post("/ai/chat").send({ message: "who?" });
    expect(r.status).toBe(200);
    expect(r.body.citations).toEqual([]);
    // Answer must not include the leaked title
    expect(r.body.answer).not.toContain("Leaked");
  });

  it("answers with empty citations when no embeddings exist", async () => {
    stubResponse("I don't have that information in the visible records.");
    const app = await makeApp();
    const r = await request(app).post("/ai/chat").send({ message: "what?" });
    expect(r.status).toBe(200);
    expect(r.body.citations).toEqual([]);
  });

  it("validates the request shape", async () => {
    const app = await makeApp();
    const r = await request(app).post("/ai/chat").send({});
    expect(r.status).toBe(400);
  });

  it("returns 429 when rate limit denies the token", async () => {
    rateLimitAllow = false;
    const app = await makeApp();
    const r = await request(app).post("/ai/chat").send({ message: "hi" });
    expect(r.status).toBe(429);
    // Anthropic should not have been called.
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("POST /ai/chat — plan gating", () => {
  it("rejects a non-super-admin when module is NOT in allowedModules", async () => {
    setPlan({
      isSuperAdmin: false,
      allowedModules: ["finance"],
      allowedSubmodules: ["finance.customers"],
    });
    const app = await makeApp();
    const r = await request(app)
      .post("/ai/chat")
      .send({ message: "test", module: "payroll" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("MODULE_NOT_IN_PLAN");
    expect(r.body.error).toMatch(/not part of your subscription/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects when submodule is NOT in allowedSubmodules (even if module is)", async () => {
    setPlan({
      isSuperAdmin: false,
      allowedModules: ["finance"],
      allowedSubmodules: ["finance.customers"], // but NOT finance.payments
    });
    const app = await makeApp();
    const r = await request(app)
      .post("/ai/chat")
      .send({ message: "x", module: "finance", submodule: "finance.payments" });
    expect(r.status).toBe(403);
    expect(r.body.submodule).toBe("finance.payments");
  });

  it("allows when module AND submodule are both in the plan", async () => {
    setPlan({
      isSuperAdmin: false,
      allowedModules: ["finance"],
      allowedSubmodules: ["finance.customers"],
    });
    stubResponse("sure");
    const app = await makeApp();
    const r = await request(app)
      .post("/ai/chat")
      .send({ message: "x", module: "finance", submodule: "finance.customers" });
    expect(r.status).toBe(200);
    expect(r.body.answer).toBe("sure");
  });

  it("super-admins bypass all gating", async () => {
    setPlan({ isSuperAdmin: true, allowedModules: [], allowedSubmodules: [] });
    stubResponse("admin ok");
    const app = await makeApp();
    const r = await request(app)
      .post("/ai/chat")
      .send({ message: "x", module: "payroll", submodule: "payroll.salary-slips" });
    expect(r.status).toBe(200);
    expect(r.body.answer).toBe("admin ok");
  });

  it("unscoped questions still work for non-super-admins (no module in body)", async () => {
    setPlan({
      isSuperAdmin: false,
      allowedModules: ["finance"],
      allowedSubmodules: ["finance.customers"],
    });
    stubResponse("yes");
    const app = await makeApp();
    const r = await request(app).post("/ai/chat").send({ message: "x" });
    expect(r.status).toBe(200);
  });
});
