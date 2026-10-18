// Real-DB integration test for the loans router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ln-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { loanRouter } = await import("./loans");
  const app = express();
  app.use(express.json());
  app.use("/loans", loanRouter);
  return app;
}

let empA: { id: string };
let empB: { id: string };
let ltA: { id: string };
let ltB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  empA = await prisma.employee.create({ data: { tenantId: tenantA.id, employeeCode: `EMP-LN-${suiteId}-A`, employeeName: 'A' }, select: { id: true } });
  empB = await prisma.employee.create({ data: { tenantId: tenantB.id, employeeCode: `EMP-LN-${suiteId}-B`, employeeName: 'B' }, select: { id: true } });
  ltA = await prisma.loanType.create({ data: { tenantId: tenantA.id, loanTypeName: `LT-LN-${suiteId}-A` }, select: { id: true } });
  ltB = await prisma.loanType.create({ data: { tenantId: tenantB.id, loanTypeName: `LT-LN-${suiteId}-B` }, select: { id: true } });

  await prisma.loan.createMany({
    data: [
      { tenantId: tenantA.id, name: `LN-${suiteId}-A1`, employeeId: empA.id, loanTypeId: ltA.id, principal: '10000', interestRate: '5.0', termMonths: 12, emi: '900' },
      { tenantId: tenantB.id, name: `LN-${suiteId}-B1`, employeeId: empB.id, loanTypeId: ltB.id, principal: '10000', interestRate: '5.0', termMonths: 12, emi: '900' },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /loans (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/loans");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`LN-${suiteId}-A1`);
    expect(values).not.toContain(`LN-${suiteId}-B1`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/loans");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`LN-${suiteId}-B1`);
    expect(values).not.toContain(`LN-${suiteId}-A1`);
  });
});
