// Real-DB integration test for the job-cards router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-jc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { jobCardRouter } = await import("./job-cards");
  const app = express();
  app.use(express.json());
  app.use("/job-cards", jobCardRouter);
  return app;
}

let itA: { id: string };
let bA: { id: string };
let wh1A: { id: string };
let wh2A: { id: string };
let woA: { id: string };
let opA: { id: string };
let wsA: { id: string };
let itB: { id: string };
let bB: { id: string };
let wh1B: { id: string };
let wh2B: { id: string };
let woB: { id: string };
let opB: { id: string };
let wsB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  itA = await prisma.item.create({ data: { tenantId: tenantA.id, itemCode: `ITM-JC-${suiteId}-A`, itemName: 'A' }, select: { id: true } });
  itB = await prisma.item.create({ data: { tenantId: tenantB.id, itemCode: `ITM-JC-${suiteId}-B`, itemName: 'B' }, select: { id: true } });
  bA = await prisma.bOM.create({ data: { tenantId: tenantA.id, name: `BOM-JC-${suiteId}-A`, productionItemId: itA.id }, select: { id: true } });
  bB = await prisma.bOM.create({ data: { tenantId: tenantB.id, name: `BOM-JC-${suiteId}-B`, productionItemId: itB.id }, select: { id: true } });
  wh1A = await prisma.warehouse.create({ data: { tenantId: tenantA.id, warehouseName: `WH-JC-S-${suiteId}-A` }, select: { id: true } });
  wh2A = await prisma.warehouse.create({ data: { tenantId: tenantA.id, warehouseName: `WH-JC-T-${suiteId}-A` }, select: { id: true } });
  wh1B = await prisma.warehouse.create({ data: { tenantId: tenantB.id, warehouseName: `WH-JC-S-${suiteId}-B` }, select: { id: true } });
  wh2B = await prisma.warehouse.create({ data: { tenantId: tenantB.id, warehouseName: `WH-JC-T-${suiteId}-B` }, select: { id: true } });
  wsA = await prisma.workstation.create({ data: { tenantId: tenantA.id, name: `WS-JC-${suiteId}-A` }, select: { id: true } });
  wsB = await prisma.workstation.create({ data: { tenantId: tenantB.id, name: `WS-JC-${suiteId}-B` }, select: { id: true } });
  woA = await prisma.workOrder.create({ data: { tenantId: tenantA.id, name: `WO-JC-${suiteId}-A`, bomId: bA.id, productionItemId: itA.id, qty: '10', sourceWarehouseId: wh1A.id, targetWarehouseId: wh2A.id }, select: { id: true } });
  woB = await prisma.workOrder.create({ data: { tenantId: tenantB.id, name: `WO-JC-${suiteId}-B`, bomId: bB.id, productionItemId: itB.id, qty: '10', sourceWarehouseId: wh1B.id, targetWarehouseId: wh2B.id }, select: { id: true } });
  opA = await prisma.workOrderOperation.create({ data: { workOrderId: woA.id, operationName: 'Op-A', workstationId: wsA.id, timeInMins: '10', hourRate: '100' }, select: { id: true } });
  opB = await prisma.workOrderOperation.create({ data: { workOrderId: woB.id, operationName: 'Op-B', workstationId: wsB.id, timeInMins: '10', hourRate: '100' }, select: { id: true } });

  await prisma.jobCard.createMany({
    data: [
      { tenantId: tenantA.id, name: `JC-${suiteId}-A1`, workOrderId: woA.id, operationId: opA.id, workstationId: wsA.id },
      { tenantId: tenantB.id, name: `JC-${suiteId}-B1`, workOrderId: woB.id, operationId: opB.id, workstationId: wsB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /job-cards (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/job-cards");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`JC-${suiteId}-A1`);
    expect(values).not.toContain(`JC-${suiteId}-B1`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/job-cards");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`JC-${suiteId}-B1`);
    expect(values).not.toContain(`JC-${suiteId}-A1`);
  });
});
