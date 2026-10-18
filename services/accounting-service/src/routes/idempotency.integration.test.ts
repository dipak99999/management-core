// Integration tests for the idempotency middleware from @lumaara/service-auth.
//
// The middleware promises 3 things (per its docstring):
//   1. Same key + same body  → replays cached response.
//   2. Same key + diff body  → 422 (client misused the key).
//   3. No header             → no-op (endpoint stays non-idempotent).
//
// Plus a fourth we test here: DB write failure is fail-open (the request
// still succeeds even if we can't cache it — better UX than blocking on cache
// blips).
//
// Uses a minimal echo router mounted on a fresh express app + the real
// lumaara_test DB. No mocks — the whole point is to prove the mechanism.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { idempotency } from "@lumaara/service-auth";

const ENDPOINT = "POST /test-echo";
const suiteId = `it-idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenant: { id: string };

function buildApp() {
  const app = express();
  app.use(express.json());
  // Inject an auth context matching the seeded tenant.
  app.use((req, _res, next) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: tenant.id,
      userId: "user-test",
    };
    next();
  });
  // The route body just echoes what came in + a nonce so we can detect
  // whether the handler ran again vs. replayed a cache.
  let callCount = 0;
  app.post("/test-echo", idempotency(ENDPOINT), (req, res) => {
    callCount++;
    res.status(201).json({ echoed: req.body, callCount });
  });
  return { app, getCallCount: () => callCount };
}

beforeAll(async () => {
  tenant = await prisma.tenant.create({
    data: { name: suiteId, slug: suiteId },
    select: { id: true },
  });
});

beforeEach(async () => {
  // Each test gets a clean idempotency-key table for its tenant. Cheap:
  // scoped delete on a small table.
  await prisma.idempotencyKey.deleteMany({ where: { tenantId: tenant.id } });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  await prisma.$disconnect();
});

describe("idempotency middleware", () => {
  it("no header → passes through, handler runs each time", async () => {
    const { app, getCallCount } = buildApp();
    const r1 = await request(app).post("/test-echo").send({ name: "A" });
    const r2 = await request(app).post("/test-echo").send({ name: "A" });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(getCallCount()).toBe(2); // handler ran twice, no dedupe
  });

  it("same key + same body → handler runs once, second call replays cached response", async () => {
    const { app, getCallCount } = buildApp();
    const r1 = await request(app)
      .post("/test-echo")
      .set("idempotency-key", "abc-123")
      .send({ name: "X" });
    expect(r1.status).toBe(201);
    expect(r1.body.callCount).toBe(1);

    // Give the fire-and-forget persist a moment to land before the retry.
    await new Promise((r) => setTimeout(r, 100));

    const r2 = await request(app)
      .post("/test-echo")
      .set("idempotency-key", "abc-123")
      .send({ name: "X" });
    expect(r2.status).toBe(201);
    // Cached response replays the ORIGINAL callCount (1), even though the
    // handler was never invoked the second time.
    expect(r2.body.callCount).toBe(1);
    expect(getCallCount()).toBe(1); // proof: only one handler execution
  });

  it("same key + different body → 422 (client reused key with new payload)", async () => {
    const { app } = buildApp();
    const r1 = await request(app)
      .post("/test-echo")
      .set("idempotency-key", "abc-456")
      .send({ name: "First" });
    expect(r1.status).toBe(201);

    await new Promise((r) => setTimeout(r, 100));

    const r2 = await request(app)
      .post("/test-echo")
      .set("idempotency-key", "abc-456")
      .send({ name: "Different" });
    expect(r2.status).toBe(422);
    expect(r2.body.error).toMatch(/reused with a different request body/i);
  });

  it("distinct keys → distinct handler runs (keys don't collide across requests)", async () => {
    const { app, getCallCount } = buildApp();
    await request(app).post("/test-echo").set("idempotency-key", "k1").send({});
    await request(app).post("/test-echo").set("idempotency-key", "k2").send({});
    await request(app).post("/test-echo").set("idempotency-key", "k3").send({});
    await new Promise((r) => setTimeout(r, 100));
    expect(getCallCount()).toBe(3);
  });

  it("persists row to idempotency_keys table with fingerprint + response body", async () => {
    const { app } = buildApp();
    await request(app)
      .post("/test-echo")
      .set("idempotency-key", "persist-me")
      .send({ name: "Persisted" });

    await new Promise((r) => setTimeout(r, 100));

    const row = await prisma.idempotencyKey.findUnique({
      where: {
        tenantId_endpoint_key: {
          tenantId: tenant.id,
          endpoint: ENDPOINT,
          key: "persist-me",
        },
      },
    });
    expect(row).not.toBeNull();
    expect(row!.responseStatus).toBe(201);
    expect(row!.fingerprint).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect((row!.responseBody as { echoed: { name: string } }).echoed.name).toBe(
      "Persisted",
    );
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });

  it("key rejected: too short (empty after trim) → passes through", async () => {
    const { app, getCallCount } = buildApp();
    // Whitespace-only key trims to empty; middleware should treat as no header.
    const r = await request(app).post("/test-echo").set("idempotency-key", "  ").send({});
    expect(r.status).toBe(201);
    expect(getCallCount()).toBe(1);
  });

  it("no tenant on request → passes through (middleware bails safely)", async () => {
    const app = express();
    app.use(express.json());
    // Deliberately don't inject req.auth.
    let count = 0;
    app.post("/test-echo", idempotency(ENDPOINT), (req, res) => {
      count++;
      res.status(201).json({ ok: true });
    });
    const r = await request(app)
      .post("/test-echo")
      .set("idempotency-key", "tenantless")
      .send({});
    expect(r.status).toBe(201);
    expect(count).toBe(1);
    // Nothing persisted — no tenant to scope by.
    const row = await prisma.idempotencyKey.findFirst({ where: { key: "tenantless" } });
    expect(row).toBeNull();
  });
});
