// Real-DB integration test for the budgets router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { budgetRouter } = await import("./budgets");
  const app = express();
  app.use(express.json());
  app.use("/budgets", budgetRouter);
  return app;
}

let fyA: { id: string };
let fyB: { id: string };
let acA: { id: string };
let acB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  fyA = await prisma.fiscalYear.create({ data: { tenantId: tenantA.id, name: `FY-BG-${suiteId}-A`, startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') }, select: { id: true } });
  fyB = await prisma.fiscalYear.create({ data: { tenantId: tenantB.id, name: `FY-BG-${suiteId}-B`, startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') }, select: { id: true } });
  acA = await prisma.account.create({ data: { tenantId: tenantA.id, accountName: `AC-BG-${suiteId}-A`, rootType: 'Expense' }, select: { id: true } });
  acB = await prisma.account.create({ data: { tenantId: tenantB.id, accountName: `AC-BG-${suiteId}-B`, rootType: 'Expense' }, select: { id: true } });

  await prisma.budget.createMany({
    data: [
      { tenantId: tenantA.id, fiscalYearId: fyA.id, accountId: acA.id, annualAmount: '100000' },
      { tenantId: tenantB.id, fiscalYearId: fyB.id, accountId: acB.id, annualAmount: '100000' },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /budgets (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/budgets");
    expect(res.status).toBe(200);
    const values = (res.body as { fiscalYearId: unknown }[]).map((r) => String(r.fiscalYearId));
    expect(values).toContain(`${fyA.id}`);
    expect(values).not.toContain(`${fyB.id}`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/budgets");
    expect(res.status).toBe(200);
    const values = (res.body as { fiscalYearId: unknown }[]).map((r) => String(r.fiscalYearId));
    expect(values).toContain(`${fyB.id}`);
    expect(values).not.toContain(`${fyA.id}`);
  });
});
