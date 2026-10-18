// Real-DB integration test for the tasks router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenantA: { id: string };
let tenantB: { id: string };
let currentTenantId: string;

vi.mock("@lumaara/service-auth", async () => {
  const actual = await vi.importActual<typeof import("@lumaara/service-auth")>(
    "@lumaara/service-auth",
  );
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: currentTenantId,
      userId: "user-test",
    };
    next();
  };
  return {
    ...actual,
    perms: () => ({
      read: pass, write: pass, create: pass, delete: pass, submit: pass, cancel: pass,
    }),
  };
});

async function buildApp() {
  const { taskRouter } = await import("./tasks");
  const app = express();
  app.use(express.json());
  app.use("/tasks", taskRouter);
  return app;
}

let projA: { id: string };
let projB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  projA = await prisma.project.create({
    data: { tenantId: tenantA.id, name: `PROJ-TASK-${suiteId}-A`, projectName: "Alpha" },
    select: { id: true },
  });
  projB = await prisma.project.create({
    data: { tenantId: tenantB.id, name: `PROJ-TASK-${suiteId}-B`, projectName: "Beta" },
    select: { id: true },
  });
  await prisma.task.createMany({
    data: [
      { tenantId: tenantA.id, projectId: projA.id, subject: `Task-${suiteId}-A1` },
      { tenantId: tenantB.id, projectId: projB.id, subject: `Task-${suiteId}-B1` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /tasks (real DB)", () => {
  it("returns only tenant A's tasks", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(200);
    const subs = (res.body as { subject: string }[]).map((r) => r.subject);
    expect(subs).toContain(`Task-${suiteId}-A1`);
    expect(subs).not.toContain(`Task-${suiteId}-B1`);
  });

  it("returns only tenant B's tasks", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(200);
    const subs = (res.body as { subject: string }[]).map((r) => r.subject);
    expect(subs).toContain(`Task-${suiteId}-B1`);
    expect(subs).not.toContain(`Task-${suiteId}-A1`);
  });
});
