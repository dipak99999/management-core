// Real-DB integration test for the salary-slips router — payroll data,
// tenant isolation matters more here than almost anywhere else.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { salarySlipRouter } = await import("./salary-slips");
  const app = express();
  app.use(express.json());
  app.use("/salary-slips", salarySlipRouter);
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
  empA = await prisma.employee.create({
    data: { tenantId: tenantA.id, employeeCode: `EMP-SS-${suiteId}-A`, employeeName: "Alice" },
    select: { id: true },
  });
  empB = await prisma.employee.create({
    data: { tenantId: tenantB.id, employeeCode: `EMP-SS-${suiteId}-B`, employeeName: "Bob" },
    select: { id: true },
  });
  await prisma.salarySlip.createMany({
    data: [
      {
        tenantId: tenantA.id, name: `SS-${suiteId}-A1`, employeeId: empA.id,
        startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"),
      },
      {
        tenantId: tenantB.id, name: `SS-${suiteId}-B1`, employeeId: empB.id,
        startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /salary-slips (real DB)", () => {
  it("returns only tenant A's slips", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/salary-slips");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`SS-${suiteId}-A1`);
    expect(names).not.toContain(`SS-${suiteId}-B1`);
  });

  it("returns only tenant B's slips", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/salary-slips");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`SS-${suiteId}-B1`);
    expect(names).not.toContain(`SS-${suiteId}-A1`);
  });
});
