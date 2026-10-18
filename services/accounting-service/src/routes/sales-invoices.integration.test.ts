// Real-DB integration test for the sales-invoices router. See
// customers.integration.test.ts for the base pattern. This test also
// exercises the company-scoping bypass path: the mocked auth carries
// role="admin" so getAllowedCompanyIds returns null (no company filter),
// letting our seed rows be visible.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-si-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenantA: { id: string };
let tenantB: { id: string };
let currentTenantId: string;

vi.mock("@lumaara/service-auth", async () => {
  const actual = await vi.importActual<typeof import("@lumaara/service-auth")>(
    "@lumaara/service-auth",
  );
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: { tenantId: string; userId: string; role: string } }).auth = {
      tenantId: currentTenantId,
      userId: "user-test",
      role: "admin",
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
  const { salesInvoiceRouter } = await import("./sales-invoices");
  const app = express();
  app.use(express.json());
  app.use("/sales-invoices", salesInvoiceRouter);
  return app;
}

let custA: { id: string };
let custB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  custA = await prisma.customer.create({
    data: { tenantId: tenantA.id, customerName: `Cust-${suiteId}-A` },
    select: { id: true },
  });
  custB = await prisma.customer.create({
    data: { tenantId: tenantB.id, customerName: `Cust-${suiteId}-B` },
    select: { id: true },
  });
  await prisma.salesInvoice.createMany({
    data: [
      { tenantId: tenantA.id, name: `SI-${suiteId}-A1`, customerId: custA.id },
      { tenantId: tenantA.id, name: `SI-${suiteId}-A2`, customerId: custA.id },
      { tenantId: tenantB.id, name: `SI-${suiteId}-B1`, customerId: custB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /sales-invoices (real DB)", () => {
  it("returns only tenant A's invoices", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/sales-invoices");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining([`SI-${suiteId}-A1`, `SI-${suiteId}-A2`]));
    expect(names).not.toContain(`SI-${suiteId}-B1`);
  });

  it("returns only tenant B's invoices", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/sales-invoices");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`SI-${suiteId}-B1`);
    expect(names).not.toContain(`SI-${suiteId}-A1`);
  });
});
