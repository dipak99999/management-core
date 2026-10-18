// Real-DB coverage for /ai-budget: aggregates AgentStep.costUsd per
// tenant per UTC day.
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-abu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function buildApp() {
  const { aiBudgetRouter } = await import("./ai-budget");
  const app = express();
  app.use(express.json());
  app.use("/ai-budget", aiBudgetRouter);
  return app;
}

let tenantId: string;
let token: string;
let taskId: string;

beforeAll(async () => {
  process.env.AI_TENANT_DAILY_USD_LIMIT = "50";
  const past = new Date(Date.now() - 60_000);
  const tenant = await prisma.tenant.create({ data: { name: `AB ${suiteId}`, slug: suiteId } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `ab-${suiteId}@x.com`,
      passwordHash: await bcrypt.hash("x", 4),
      fullName: "AB",
      role: "admin",
      emailVerifiedAt: new Date(),
      tokenEpoch: past,
    },
  });
  token = jwt.sign({ userId: user.id, tenantId, email: user.email, role: "admin", roles: [] }, JWT_SECRET, { expiresIn: "1h" });

  const task = await prisma.agentTask.create({
    data: {
      tenantId,
      agentKind: "test",
      name: `t-${suiteId}`,
      goal: "integration-test",
      status: "Completed",
    },
  });
  taskId = task.id;
  // Three completed AgentStep rows totalling $1.23 for today, plus one
  // from yesterday that should NOT be included.
  const todayStart = new Date();
  todayStart.setUTCHours(1, 0, 0, 0);
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await prisma.agentStep.createMany({
    data: [
      { tenantId, taskId, ordinal: 1, kind: "ToolCall", status: "Succeeded", costUsd: 0.5, inputTokens: 100, outputTokens: 200, startedAt: todayStart, finishedAt: todayStart },
      { tenantId, taskId, ordinal: 2, kind: "Think", status: "Succeeded", costUsd: 0.73, inputTokens: 50, outputTokens: 300, startedAt: todayStart, finishedAt: todayStart },
      { tenantId, taskId, ordinal: 3, kind: "Think", status: "Succeeded", costUsd: 2.5, inputTokens: 10, outputTokens: 20, startedAt: yesterday, finishedAt: yesterday },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("ai-budget", () => {
  it("returns today's spend sum + env-configured limit", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get("/ai-budget")
      .set("authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    // Decimal rounding: 0.5 + 0.73 = 1.23 (yesterday's 2.5 excluded).
    expect(r.body.used).toBeCloseTo(1.23, 2);
    expect(r.body.limit).toBe(50);
    expect(r.body.currency).toBe("USD");
    expect(r.body.inputTokens).toBe(150);
    expect(r.body.outputTokens).toBe(500);
    expect(r.body.windowStart).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00/);
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    expect((await request(app).get("/ai-budget")).status).toBe(401);
  });
});
