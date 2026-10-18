// Real-DB integration test for the purchase-orders router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-po-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { purchaseOrderRouter } = await import("./purchase-orders");
  const app = express();
  app.use(express.json());
  app.use("/purchase-orders", purchaseOrderRouter);
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
  supA = await prisma.supplier.create({ data: { tenantId: tenantA.id, supplierName: `PO-Sup-${suiteId}-A` }, select: { id: true } });
  supB = await prisma.supplier.create({ data: { tenantId: tenantB.id, supplierName: `PO-Sup-${suiteId}-B` }, select: { id: true } });

  await prisma.purchaseOrder.createMany({
    data: [
      { tenantId: tenantA.id, name: `PO-${suiteId}-A1`, supplierId: supA.id },
      { tenantId: tenantB.id, name: `PO-${suiteId}-B1`, supplierId: supB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /purchase-orders (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/purchase-orders");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`PO-${suiteId}-A1`);
    expect(values).not.toContain(`PO-${suiteId}-B1`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/purchase-orders");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`PO-${suiteId}-B1`);
    expect(values).not.toContain(`PO-${suiteId}-A1`);
  });
});
