// Real-DB coverage for /ai/draft. The chat provider resolver is mocked
// via vi.doMock so no upstream LLM is hit — the test exercises parsing,
// error paths, and auth gating.
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type Mode = "ok" | "non-json" | "throw" | "no-provider";

async function buildApp(stub: { mode: Mode; text?: string }) {
  vi.resetModules();
  vi.doMock("@lumaara/db", async () => {
    const actual = await vi.importActual<typeof import("@lumaara/db")>("@lumaara/db");
    const resolveChatProvider = async () => {
      if (stub.mode === "no-provider") throw new actual.NoChatProviderError();
      return {
        kind: "anthropic" as const,
        model: "claude-stub",
        async chat() {
          if (stub.mode === "throw") throw new Error("provider boom");
          return {
            text: stub.text ?? `{"summary":"Draft","rows":[{"field":"customerName","before":null,"after":"Acme","editable":true}]}`,
            provider: "anthropic" as const,
            model: "claude-stub",
            inputTokens: 100,
            outputTokens: 50,
          };
        },
        async *stream() { yield ""; return { model: "claude-stub", inputTokens: 0, outputTokens: 0 }; },
      };
    };
    return { ...actual, resolveChatProvider };
  });
  const { aiDraftRouter } = await import("./ai-draft");
  const app = express();
  app.use(express.json());
  app.use("/ai/draft", aiDraftRouter);
  return app;
}

let tenantId: string;
let token: string;

beforeAll(async () => {
  const past = new Date(Date.now() - 60_000);
  const tenant = await prisma.tenant.create({ data: { name: `D ${suiteId}`, slug: suiteId } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `d-${suiteId}@x.com`,
      passwordHash: await bcrypt.hash("x", 4),
      fullName: "D",
      role: "admin",
      emailVerifiedAt: new Date(),
      tokenEpoch: past,
    },
  });
  token = jwt.sign(
    { userId: user.id, tenantId, email: user.email, role: "admin", roles: [] },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
});

beforeEach(() => {
  vi.resetModules();
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("ai-draft", () => {
  it("parses the AI response and returns a structured diff", async () => {
    const app = await buildApp({ mode: "ok" });
    const r = await request(app)
      .post("/ai/draft")
      .set("authorization", `Bearer ${token}`)
      .send({ prompt: "Draft an invoice for Acme", scope: "sales-invoice-draft", fields: ["customerName"] });
    expect(r.status).toBe(200);
    expect(r.body.summary).toBe("Draft");
    expect(r.body.rows[0].field).toBe("customerName");
    expect(r.body.rows[0].after).toBe("Acme");
    expect(r.body.model).toBe("claude-stub");
    expect(typeof r.body.costUsd).toBe("number");
  });

  it("tolerates prose wrapper around the JSON", async () => {
    const app = await buildApp({
      mode: "ok",
      text: `Here is the draft:\n{"summary":"wrap","rows":[]}\nLet me know.`,
    });
    const r = await request(app)
      .post("/ai/draft")
      .set("authorization", `Bearer ${token}`)
      .send({ prompt: "x", scope: "s" });
    expect(r.status).toBe(200);
    expect(r.body.summary).toBe("wrap");
  });

  it("502s when the AI returns non-JSON", async () => {
    const app = await buildApp({ mode: "non-json", text: "I cannot help with that." });
    const r = await request(app)
      .post("/ai/draft")
      .set("authorization", `Bearer ${token}`)
      .send({ prompt: "x", scope: "s" });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/non-JSON/);
  });

  it("502s when the provider throws", async () => {
    const app = await buildApp({ mode: "throw" });
    const r = await request(app)
      .post("/ai/draft")
      .set("authorization", `Bearer ${token}`)
      .send({ prompt: "x", scope: "s" });
    expect(r.status).toBe(502);
  });

  it("503s with AI_NOT_CONFIGURED when no provider is set up", async () => {
    const app = await buildApp({ mode: "no-provider" });
    const r = await request(app)
      .post("/ai/draft")
      .set("authorization", `Bearer ${token}`)
      .send({ prompt: "x", scope: "s" });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("AI_NOT_CONFIGURED");
  });

  it("400 on missing prompt", async () => {
    const app = await buildApp({ mode: "ok" });
    const r = await request(app)
      .post("/ai/draft")
      .set("authorization", `Bearer ${token}`)
      .send({ scope: "s" });
    expect(r.status).toBe(400);
  });

  it("401 without auth", async () => {
    const app = await buildApp({ mode: "ok" });
    const r = await request(app).post("/ai/draft").send({ prompt: "x", scope: "s" });
    expect(r.status).toBe(401);
  });
});
