// Tests the auth paths on /stream — the EventSource client proper isn't
// exercised here (would need a running server + a browser-like consumer);
// instead we verify: (a) /stream rejects without auth, (b) ?token= gets
// elevated into Authorization, (c) /_internal/publish rejects without the
// shared secret.
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const SERVICE_SECRET = "test-service-secret-value";

async function buildApp() {
  process.env.SERVICE_SECRET = SERVICE_SECRET;
  const { streamRouter } = await import("./stream");
  const app = express();
  app.use(express.json());
  app.use("/stream", streamRouter);
  return app;
}

let tenantId: string;
let userToken: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: `Stream ${suiteId}`, slug: suiteId },
  });
  tenantId = tenant.id;
  const past = new Date(Date.now() - 60_000);
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `stream-${suiteId}@example.com`,
      passwordHash: await bcrypt.hash("x", 4),
      fullName: "Stream Tester",
      role: "admin",
      emailVerifiedAt: new Date(),
      tokenEpoch: past,
    },
  });
  userToken = jwt.sign(
    { userId: user.id, tenantId, email: user.email, role: "admin", roles: [] },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("/stream auth", () => {
  it("rejects without a token", async () => {
    const app = await buildApp();
    const r = await request(app).get("/stream?channel=pick-list");
    expect(r.status).toBe(401);
  });

  it("accepts a Bearer token via ?token= (auth passes → missing-channel 400)", async () => {
    // Can't easily consume a long-lived SSE stream in supertest, so
    // instead we probe the auth path: hit /stream with ?token= but no
    // ?channel=. If the token is elevated to Authorization correctly,
    // requireAuth passes and the handler returns 400 for missing channel.
    // If the token path is broken, requireAuth returns 401 instead.
    const app = await buildApp();
    const r = await request(app).get(
      `/stream?token=${encodeURIComponent(userToken)}`,
    );
    expect(r.status).toBe(400);
  });
});

describe("/stream/_internal/publish", () => {
  it("rejects without the service secret", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/stream/_internal/publish")
      .send({ tenantId, channel: "pick-list", data: {} });
    expect(r.status).toBe(403);
  });

  it("rejects with a wrong service secret", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/stream/_internal/publish")
      .set("x-service-secret", "wrong")
      .send({ tenantId, channel: "pick-list", data: {} });
    expect(r.status).toBe(403);
  });

  it("accepts and 204s with the correct secret", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/stream/_internal/publish")
      .set("x-service-secret", SERVICE_SECRET)
      .send({ tenantId, channel: "pick-list", data: { id: "pl-1" } });
    expect(r.status).toBe(204);
  });

  it("400s when tenantId/channel missing", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/stream/_internal/publish")
      .set("x-service-secret", SERVICE_SECRET)
      .send({});
    expect(r.status).toBe(400);
  });
});
