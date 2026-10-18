// Real-DB integration test for the milestones router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { milestoneRouter } = await import("./milestones");
  const app = express();
  app.use(express.json());
  app.use("/milestones", milestoneRouter);
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
    data: { tenantId: tenantA.id, name: `PROJ-MS-${suiteId}-A`, projectName: "Alpha" },
    select: { id: true },
  });
  projB = await prisma.project.create({
    data: { tenantId: tenantB.id, name: `PROJ-MS-${suiteId}-B`, projectName: "Beta" },
    select: { id: true },
  });
  await prisma.milestone.createMany({
    data: [
      { tenantId: tenantA.id, projectId: projA.id, name: `MS-${suiteId}-A1` },
      { tenantId: tenantB.id, projectId: projB.id, name: `MS-${suiteId}-B1` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /milestones (real DB)", () => {
  it("returns only tenant A's milestones", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/milestones");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`MS-${suiteId}-A1`);
    expect(names).not.toContain(`MS-${suiteId}-B1`);
  });

  it("returns only tenant B's milestones", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/milestones");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`MS-${suiteId}-B1`);
    expect(names).not.toContain(`MS-${suiteId}-A1`);
  });
});
