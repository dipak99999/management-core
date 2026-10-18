// Real-DB integration test for the work-orders router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-wo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { workOrderRouter } = await import("./work-orders");
  const app = express();
  app.use(express.json());
  app.use("/work-orders", workOrderRouter);
  return app;
}

let itA: { id: string };
let bA: { id: string };
let whA1: { id: string };
let whA2: { id: string };
let itB: { id: string };
let bB: { id: string };
let whB1: { id: string };
let whB2: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  itA = await prisma.item.create({ data: { tenantId: tenantA.id, itemCode: `ITM-WO-${suiteId}-A`, itemName: 'A' }, select: { id: true } });
  itB = await prisma.item.create({ data: { tenantId: tenantB.id, itemCode: `ITM-WO-${suiteId}-B`, itemName: 'B' }, select: { id: true } });
  bA = await prisma.bOM.create({ data: { tenantId: tenantA.id, name: `BOM-WO-${suiteId}-A`, productionItemId: itA.id }, select: { id: true } });
  bB = await prisma.bOM.create({ data: { tenantId: tenantB.id, name: `BOM-WO-${suiteId}-B`, productionItemId: itB.id }, select: { id: true } });
  whA1 = await prisma.warehouse.create({ data: { tenantId: tenantA.id, warehouseName: `WH-WO-S-${suiteId}-A` }, select: { id: true } });
  whA2 = await prisma.warehouse.create({ data: { tenantId: tenantA.id, warehouseName: `WH-WO-T-${suiteId}-A` }, select: { id: true } });
  whB1 = await prisma.warehouse.create({ data: { tenantId: tenantB.id, warehouseName: `WH-WO-S-${suiteId}-B` }, select: { id: true } });
  whB2 = await prisma.warehouse.create({ data: { tenantId: tenantB.id, warehouseName: `WH-WO-T-${suiteId}-B` }, select: { id: true } });

  await prisma.workOrder.createMany({
    data: [
      { tenantId: tenantA.id, name: `WO-${suiteId}-A1`, bomId: bA.id, productionItemId: itA.id, qty: '10', sourceWarehouseId: whA1.id, targetWarehouseId: whA2.id },
      { tenantId: tenantB.id, name: `WO-${suiteId}-B1`, bomId: bB.id, productionItemId: itB.id, qty: '10', sourceWarehouseId: whB1.id, targetWarehouseId: whB2.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /work-orders (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/work-orders");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`WO-${suiteId}-A1`);
    expect(values).not.toContain(`WO-${suiteId}-B1`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/work-orders");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`WO-${suiteId}-B1`);
    expect(values).not.toContain(`WO-${suiteId}-A1`);
  });
});
