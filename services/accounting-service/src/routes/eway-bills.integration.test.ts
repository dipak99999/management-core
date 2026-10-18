// Real-DB integration test for the eway-bills router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ewb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { ewayBillRouter } = await import("./eway-bills");
  const app = express();
  app.use(express.json());
  app.use("/eway-bills", ewayBillRouter);
  return app;
}

let custA: { id: string };
let custB: { id: string };
let siA: { id: string };
let siB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  custA = await prisma.customer.create({ data: { tenantId: tenantA.id, customerName: `EWB-Cust-${suiteId}-A` }, select: { id: true } });
  custB = await prisma.customer.create({ data: { tenantId: tenantB.id, customerName: `EWB-Cust-${suiteId}-B` }, select: { id: true } });
  siA = await prisma.salesInvoice.create({ data: { tenantId: tenantA.id, name: `SI-EWB-${suiteId}-A`, customerId: custA.id }, select: { id: true } });
  siB = await prisma.salesInvoice.create({ data: { tenantId: tenantB.id, name: `SI-EWB-${suiteId}-B`, customerId: custB.id }, select: { id: true } });

  await prisma.eWayBill.createMany({
    data: [
      { tenantId: tenantA.id, salesInvoiceId: siA.id, ewbNumber: `EWB-${suiteId}-A`, ewbDate: new Date('2026-01-15'), distanceKm: 100, validFrom: new Date('2026-01-15'), validTo: new Date('2026-01-20'), transportMode: 1 },
      { tenantId: tenantB.id, salesInvoiceId: siB.id, ewbNumber: `EWB-${suiteId}-B`, ewbDate: new Date('2026-01-15'), distanceKm: 100, validFrom: new Date('2026-01-15'), validTo: new Date('2026-01-20'), transportMode: 1 },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /eway-bills (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/eway-bills");
    expect(res.status).toBe(200);
    const values = (res.body as { ewbNumber: unknown }[]).map((r) => String(r.ewbNumber));
    expect(values).toContain(`EWB-${suiteId}-A`);
    expect(values).not.toContain(`EWB-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/eway-bills");
    expect(res.status).toBe(200);
    const values = (res.body as { ewbNumber: unknown }[]).map((r) => String(r.ewbNumber));
    expect(values).toContain(`EWB-${suiteId}-B`);
    expect(values).not.toContain(`EWB-${suiteId}-A`);
  });
});
