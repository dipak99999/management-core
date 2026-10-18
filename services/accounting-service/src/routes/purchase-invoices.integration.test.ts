// Real-DB integration test for the purchase-invoices router. See
// sales-invoices.integration.test.ts for the role="admin" rationale.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-pi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { purchaseInvoiceRouter } = await import("./purchase-invoices");
  const app = express();
  app.use(express.json());
  app.use("/purchase-invoices", purchaseInvoiceRouter);
  return app;
}

let supA: { id: string };
let supB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  supA = await prisma.supplier.create({
    data: { tenantId: tenantA.id, supplierName: `Sup-${suiteId}-A` },
    select: { id: true },
  });
  supB = await prisma.supplier.create({
    data: { tenantId: tenantB.id, supplierName: `Sup-${suiteId}-B` },
    select: { id: true },
  });
  await prisma.purchaseInvoice.createMany({
    data: [
      { tenantId: tenantA.id, name: `PI-${suiteId}-A1`, supplierId: supA.id },
      { tenantId: tenantB.id, name: `PI-${suiteId}-B1`, supplierId: supB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /purchase-invoices (real DB)", () => {
  it("returns only tenant A's invoices", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/purchase-invoices");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`PI-${suiteId}-A1`);
    expect(names).not.toContain(`PI-${suiteId}-B1`);
  });

  it("returns only tenant B's invoices", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/purchase-invoices");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`PI-${suiteId}-B1`);
    expect(names).not.toContain(`PI-${suiteId}-A1`);
  });
});
