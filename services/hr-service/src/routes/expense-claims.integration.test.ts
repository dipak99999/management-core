// Real-DB integration test for the expense-claims router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { expenseClaimRouter } = await import("./expense-claims");
  const app = express();
  app.use(express.json());
  app.use("/expense-claims", expenseClaimRouter);
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
  empA = await prisma.employee.create({ data: { tenantId: tenantA.id, employeeCode: `EMP-EC-${suiteId}-A`, employeeName: 'A' }, select: { id: true } });
  empB = await prisma.employee.create({ data: { tenantId: tenantB.id, employeeCode: `EMP-EC-${suiteId}-B`, employeeName: 'B' }, select: { id: true } });

  await prisma.expenseClaim.createMany({
    data: [
      { tenantId: tenantA.id, name: `EC-${suiteId}-A1`, employeeId: empA.id, totalAmount: '100.00' },
      { tenantId: tenantB.id, name: `EC-${suiteId}-B1`, employeeId: empB.id, totalAmount: '100.00' },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /expense-claims (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/expense-claims");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`EC-${suiteId}-A1`);
    expect(values).not.toContain(`EC-${suiteId}-B1`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/expense-claims");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`EC-${suiteId}-B1`);
    expect(values).not.toContain(`EC-${suiteId}-A1`);
  });
});
