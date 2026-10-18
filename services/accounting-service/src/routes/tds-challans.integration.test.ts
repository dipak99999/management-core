// Real-DB integration test for the tds-challans router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-tds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { tdsChallanRouter } = await import("./tds-challans");
  const app = express();
  app.use(express.json());
  app.use("/tds-challans", tdsChallanRouter);
  return app;
}

let acA: { id: string };
let acB: { id: string };
let cA: { id: string };
let cB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  acA = await prisma.account.create({ data: { tenantId: tenantA.id, accountName: `TAcc-${suiteId}-A`, rootType: 'Liability' }, select: { id: true } });
  acB = await prisma.account.create({ data: { tenantId: tenantB.id, accountName: `TAcc-${suiteId}-B`, rootType: 'Liability' }, select: { id: true } });
  cA = await prisma.taxWithholdingCategory.create({ data: { tenantId: tenantA.id, name: `TWC-${suiteId}-A`, rate: '0.10', accountId: acA.id }, select: { id: true } });
  cB = await prisma.taxWithholdingCategory.create({ data: { tenantId: tenantB.id, name: `TWC-${suiteId}-B`, rate: '0.10', accountId: acB.id }, select: { id: true } });

  await prisma.tdsChallan.createMany({
    data: [
      { tenantId: tenantA.id, categoryId: cA.id, bsrCode: '000A', challanSerialNo: `CH-${suiteId}-A`, paidDate: new Date('2026-01-15'), amountPaid: '1000', fyLabel: 'FY2026', quarter: 4 },
      { tenantId: tenantB.id, categoryId: cB.id, bsrCode: '000B', challanSerialNo: `CH-${suiteId}-B`, paidDate: new Date('2026-01-15'), amountPaid: '1000', fyLabel: 'FY2026', quarter: 4 },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /tds-challans (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/tds-challans");
    expect(res.status).toBe(200);
    const values = (res.body as { challanSerialNo: unknown }[]).map((r) => String(r.challanSerialNo));
    expect(values).toContain(`CH-${suiteId}-A`);
    expect(values).not.toContain(`CH-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/tds-challans");
    expect(res.status).toBe(200);
    const values = (res.body as { challanSerialNo: unknown }[]).map((r) => String(r.challanSerialNo));
    expect(values).toContain(`CH-${suiteId}-B`);
    expect(values).not.toContain(`CH-${suiteId}-A`);
  });
});
