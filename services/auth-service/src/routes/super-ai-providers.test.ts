// Hermetic unit tests — prisma is mocked at the module boundary so
// these never touch a real DB (and never wipe your dev state).
//
// NOTE: an earlier iteration of this file used the real prisma client,
// which caused `beforeEach(wipe)` to delete all platform_ai_providers
// rows in whatever DB DATABASE_URL pointed at — including the dev
// instance operators were using. The mocked version is the right
// pattern per vitest.config.ts' "stay hermetic (no DB)" directive.

process.env.MASTER_SECRET_KEY = "a".repeat(64);

import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---- @lumaara/service-auth stub — pass every request as super-admin ---
vi.mock("@lumaara/service-auth", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@lumaara/service-auth");
  return {
    ...actual,
    requireAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).auth = { userId: "test-user", tenantId: "test-tenant", email: "test@local" };
      next();
    },
    requireSuperAdmin: (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => next(),
  };
});

// ---- @lumaara/db — in-memory PlatformAiProvider table ----------------
interface Row {
  id: string;
  provider: string;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  defaultModel: string | null;
  baseUrl: string | null;
  config: Record<string, unknown>;
  secrets: unknown;
  lastTestedAt: Date | null;
  lastTestResult: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const store = new Map<string, Row>();
let idCounter = 0;
const nextId = () => `test-${++idCounter}`;

vi.mock("@lumaara/db", async () => {
  const real = await vi.importActual<typeof import("../../../../packages/db/src/secrets-crypto")>(
    "../../../../packages/db/src/secrets-crypto",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function matches(row: Row, where: any): boolean {
    for (const [k, v] of Object.entries(where ?? {})) {
      if (v === undefined) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (k === "NOT") {
        if (matches(row, v)) return false;
        continue;
      }
      if ((row as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
  }
  return {
    encryptSecrets: real.encryptSecrets,
    decryptSecrets: real.decryptSecrets,
    // The test endpoint uses createRazorpayOrder — we never call it from
    // these tests (the gateway tests do), so stub minimally.
    createRazorpayOrder: async () => { throw new Error("not mocked in this suite"); },
    // Super-admin audit middleware fires after every request; stub to no-op
    // so the fire-and-forget write doesn't blow up the mocked prisma.
    writeChainedSuperAdminEntry: async () => ({
      id: "test-audit",
      entryHash: "x",
      sequence: 1,
    }),
    prisma: {
      platformAiProvider: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async findMany({ orderBy }: any = {}) {
          const rows = Array.from(store.values());
          // Simple orderBy — ignore complex specs; sort by createdAt asc as default.
          return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async findUnique({ where }: any) {
          return store.get(where.id) ?? null;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async create({ data }: any) {
          const now = new Date();
          const row: Row = {
            id: nextId(),
            provider: data.provider,
            label: data.label,
            isActive: data.isActive ?? true,
            isDefault: data.isDefault ?? false,
            priority: data.priority ?? 100,
            defaultModel: data.defaultModel ?? null,
            baseUrl: data.baseUrl ?? null,
            config: data.config ?? {},
            secrets: data.secrets ?? {},
            lastTestedAt: null,
            lastTestResult: null,
            createdAt: now,
            updatedAt: now,
          };
          store.set(row.id, row);
          return row;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async update({ where, data }: any) {
          const row = store.get(where.id);
          if (!row) throw new Error("not found");
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async updateMany({ where, data }: any) {
          let count = 0;
          for (const row of store.values()) {
            if (matches(row, where)) {
              Object.assign(row, data, { updatedAt: new Date() });
              count++;
            }
          }
          return { count };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async delete({ where }: any) {
          const row = store.get(where.id);
          if (!row) throw new Error("not found");
          store.delete(where.id);
          return row;
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: async (fn: any) => {
        // Immediate-mode fake transaction — passes the same prisma proxy
        // through so the handler's $transaction(async tx => ...) works.
        // Our test cases don't rely on rollback semantics.
        return fn({
          platformAiProvider: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            findMany: async (a: any) => (await import("@lumaara/db")).prisma.platformAiProvider.findMany(a),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            findUnique: async (a: any) => (await import("@lumaara/db")).prisma.platformAiProvider.findUnique(a),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            create: async (a: any) => (await import("@lumaara/db")).prisma.platformAiProvider.create(a),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update: async (a: any) => (await import("@lumaara/db")).prisma.platformAiProvider.update(a),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            updateMany: async (a: any) => (await import("@lumaara/db")).prisma.platformAiProvider.updateMany(a),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete: async (a: any) => (await import("@lumaara/db")).prisma.platformAiProvider.delete(a),
          },
        });
      },
      $disconnect: async () => void 0,
    },
    // Chat provider builder for the /test endpoint — call global fetch so
    // tests can stub a 401/200 response per case.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buildChatProviderFromSecrets: ({ provider, apiKey }: any) => ({
      kind: provider,
      model: "test-model",
      chat: async () => {
        const r = await fetch("https://example.test/ping", {
          headers: { authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`${provider} ${r.status}: ${t.slice(0, 300)}`);
        }
        return { text: "ok", provider, model: "test-model", inputTokens: 0, outputTokens: 0 };
      },
      stream: async function* () { return { model: "test-model", inputTokens: 0, outputTokens: 0 }; },
    }),
  };
});

import { superAiProvidersRouter } from "./super-ai-providers";

const app = express();
app.use(express.json());
app.use("/super/ai-providers", superAiProvidersRouter);

beforeEach(() => {
  store.clear();
  idCounter = 0;
});

afterAll(() => {
  store.clear();
});

describe("super-admin AI providers CRUD", () => {
  it("GET returns [] when nothing configured", async () => {
    const r = await request(app).get("/super/ai-providers");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("POST creates an anthropic provider and redacts the apiKey", async () => {
    const r = await request(app).post("/super/ai-providers").send({
      provider: "anthropic",
      label: "Prod Claude",
      apiKey: "sk-ant-super-secret",
      isDefault: true,
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      provider: "anthropic",
      label: "Prod Claude",
      isDefault: true,
      hasApiKey: true,
    });
    // Critical: raw apiKey must never appear in the response
    expect(JSON.stringify(r.body)).not.toContain("sk-ant-super-secret");
  });

  it("POST rejects a provider type outside the enum", async () => {
    const r = await request(app).post("/super/ai-providers").send({
      provider: "bogus",
      label: "x",
      apiKey: "k",
    });
    expect(r.status).toBe(400);
  });

  it("PATCH without apiKey preserves the stored key", async () => {
    const created = await request(app).post("/super/ai-providers").send({
      provider: "openai",
      label: "original",
      apiKey: "sk-original",
    });
    const id = created.body.id;
    const patched = await request(app)
      .patch(`/super/ai-providers/${id}`)
      .send({ label: "renamed" }); // apiKey omitted
    expect(patched.status).toBe(200);
    expect(patched.body.label).toBe("renamed");
    expect(patched.body.hasApiKey).toBe(true); // still there
  });

  it("activate flips default + unsets prior defaults", async () => {
    const a = await request(app).post("/super/ai-providers").send({
      provider: "anthropic",
      label: "a",
      apiKey: "k1",
      isDefault: true,
    });
    const b = await request(app).post("/super/ai-providers").send({
      provider: "openai",
      label: "b",
      apiKey: "k2",
      isDefault: false,
    });
    const act = await request(app)
      .post(`/super/ai-providers/${b.body.id}/activate`)
      .send();
    expect(act.status).toBe(200);
    expect(act.body.isDefault).toBe(true);

    const list = await request(app).get("/super/ai-providers");
    const aAfter = list.body.find(
      (r: { id: string }) => r.id === a.body.id,
    );
    expect(aAfter.isDefault).toBe(false); // old default got demoted
  });

  it("DELETE removes the row", async () => {
    const created = await request(app).post("/super/ai-providers").send({
      provider: "anthropic",
      label: "throwaway",
      apiKey: "k",
    });
    const id = created.body.id;
    const del = await request(app).delete(`/super/ai-providers/${id}`);
    expect(del.status).toBe(204);
    const list = await request(app).get("/super/ai-providers");
    expect(list.body.find((r: { id: string }) => r.id === id)).toBeUndefined();
  });

  it("test endpoint surfaces upstream auth failures as 502 with the error", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: { message: "bad key" } }),
        { status: 401 },
      )) as typeof fetch;
    const created = await request(app).post("/super/ai-providers").send({
      provider: "anthropic",
      label: "bad-key-test",
      apiKey: "sk-ant-definitely-wrong",
    });
    const t = await request(app).post(`/super/ai-providers/${created.body.id}/test`);
    expect(t.status).toBe(502);
    expect(t.body.ok).toBe(false);
    expect(t.body.error).toMatch(/401/);
    // The lastTestedAt + lastTestResult should be persisted
    const list = await request(app).get("/super/ai-providers");
    const row = list.body.find((r: { id: string }) => r.id === created.body.id);
    expect(row.lastTestedAt).toBeTruthy();
    expect(row.lastTestResult).toMatch(/401/);
  });
});
