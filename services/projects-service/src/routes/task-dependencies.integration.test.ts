// Real-DB integration test for the task-dependencies router. TaskDependency
// is a join table between Tasks — it has NO tenantId column of its own.
// Tenant isolation is enforced transitively via the fromTask relation. This
// test proves that guarantee holds: a query authed as tenant A never sees a
// dependency row whose fromTask belongs to tenant B.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-td-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { taskDependencyRouter } = await import("./task-dependencies");
  const app = express();
  app.use(express.json());
  app.use("/task-dependencies", taskDependencyRouter);
  return app;
}

let projA: { id: string };
let projB: { id: string };
let t1A: { id: string };
let t2A: { id: string };
let t1B: { id: string };
let t2B: { id: string };

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
    data: { tenantId: tenantA.id, name: `PROJ-TD-${suiteId}-A`, projectName: "A" },
    select: { id: true },
  });
  projB = await prisma.project.create({
    data: { tenantId: tenantB.id, name: `PROJ-TD-${suiteId}-B`, projectName: "B" },
    select: { id: true },
  });
  t1A = await prisma.task.create({
    data: { tenantId: tenantA.id, projectId: projA.id, subject: `TA1-${suiteId}` },
    select: { id: true },
  });
  t2A = await prisma.task.create({
    data: { tenantId: tenantA.id, projectId: projA.id, subject: `TA2-${suiteId}` },
    select: { id: true },
  });
  t1B = await prisma.task.create({
    data: { tenantId: tenantB.id, projectId: projB.id, subject: `TB1-${suiteId}` },
    select: { id: true },
  });
  t2B = await prisma.task.create({
    data: { tenantId: tenantB.id, projectId: projB.id, subject: `TB2-${suiteId}` },
    select: { id: true },
  });
  // Two dependency rows — one per tenant. TaskDependency has no tenantId of
  // its own; the router filters via fromTask.tenantId.
  await prisma.taskDependency.createMany({
    data: [
      { fromTaskId: t1A.id, toTaskId: t2A.id },
      { fromTaskId: t1B.id, toTaskId: t2B.id },
    ],
  });
});

afterAll(async () => {
  // Cascade delete via Task (onDelete: Cascade) removes the dependency rows.
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

interface DepRow {
  fromTask: { id: string; subject: string };
  toTask: { id: string; subject: string };
}

describe("GET /task-dependencies (real DB — transitive tenant scope)", () => {
  it("returns only dependencies whose fromTask belongs to tenant A", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/task-dependencies");
    expect(res.status).toBe(200);
    const rows = res.body as DepRow[];
    const fromIds = rows.map((r) => r.fromTask.id);
    expect(fromIds).toContain(t1A.id);
    expect(fromIds).not.toContain(t1B.id);
  });

  it("returns only dependencies whose fromTask belongs to tenant B", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/task-dependencies");
    expect(res.status).toBe(200);
    const rows = res.body as DepRow[];
    const fromIds = rows.map((r) => r.fromTask.id);
    expect(fromIds).toContain(t1B.id);
    expect(fromIds).not.toContain(t1A.id);
  });
});
