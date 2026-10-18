// Real-DB integration test for the issues router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-iss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { issueRouter } = await import("./issues");
  const app = express();
  app.use(express.json());
  app.use("/issues", issueRouter);
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
    data: { tenantId: tenantA.id, name: `PROJ-ISS-${suiteId}-A`, projectName: 'Alpha' },
    select: { id: true },
  });
  projB = await prisma.project.create({
    data: { tenantId: tenantB.id, name: `PROJ-ISS-${suiteId}-B`, projectName: 'Beta' },
    select: { id: true },
  });

  await prisma.issue.createMany({
    data: [
      { tenantId: tenantA.id, name: `ISS-${suiteId}-A1`, projectId: projA.id, title: `Issue-${suiteId}-A`, reporterUserId: "user-test" },
      { tenantId: tenantB.id, name: `ISS-${suiteId}-B1`, projectId: projB.id, title: `Issue-${suiteId}-B`, reporterUserId: "user-test" },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /issues (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/issues");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`ISS-${suiteId}-A1`);
    expect(values).not.toContain(`ISS-${suiteId}-B1`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/issues");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`ISS-${suiteId}-B1`);
    expect(values).not.toContain(`ISS-${suiteId}-A1`);
  });
});
