// Real-DB integration test for the employee-checkins router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ci-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { employeeCheckinRouter } = await import("./employee-checkins");
  const app = express();
  app.use(express.json());
  app.use("/employee-checkins", employeeCheckinRouter);
  return app;
}

let empA: { id: string };
let empB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  empA = await prisma.employee.create({ data: { tenantId: tenantA.id, employeeCode: `EMP-CI-${suiteId}-A`, employeeName: 'A' }, select: { id: true } });
  empB = await prisma.employee.create({ data: { tenantId: tenantB.id, employeeCode: `EMP-CI-${suiteId}-B`, employeeName: 'B' }, select: { id: true } });

  await prisma.employeeCheckin.createMany({
    data: [
      { tenantId: tenantA.id, employeeId: empA.id, ts: new Date('2026-01-15T09:00:00Z'), logType: 'IN' },
      { tenantId: tenantB.id, employeeId: empB.id, ts: new Date('2026-01-15T09:00:00Z'), logType: 'IN' },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /employee-checkins (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/employee-checkins");
    expect(res.status).toBe(200);
    const values = (res.body as { employeeId: unknown }[]).map((r) => String(r.employeeId));
    expect(values).toContain(`${empA.id}`);
    expect(values).not.toContain(`${empB.id}`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/employee-checkins");
    expect(res.status).toBe(200);
    const values = (res.body as { employeeId: unknown }[]).map((r) => String(r.employeeId));
    expect(values).toContain(`${empB.id}`);
    expect(values).not.toContain(`${empA.id}`);
  });
});
