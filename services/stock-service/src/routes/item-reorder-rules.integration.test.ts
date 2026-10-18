// Real-DB integration test for the item-reorder-rules router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-irr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { itemReorderRuleRouter } = await import("./item-reorder-rules");
  const app = express();
  app.use(express.json());
  app.use("/item-reorder-rules", itemReorderRuleRouter);
  return app;
}

let itmA: { id: string };
let whA: { id: string };
let itmB: { id: string };
let whB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  itmA = await prisma.item.create({ data: { tenantId: tenantA.id, itemCode: `ITM-IRR-${suiteId}-A`, itemName: 'A' }, select: { id: true } });
  whA = await prisma.warehouse.create({ data: { tenantId: tenantA.id, warehouseName: `WH-IRR-${suiteId}-A` }, select: { id: true } });
  itmB = await prisma.item.create({ data: { tenantId: tenantB.id, itemCode: `ITM-IRR-${suiteId}-B`, itemName: 'B' }, select: { id: true } });
  whB = await prisma.warehouse.create({ data: { tenantId: tenantB.id, warehouseName: `WH-IRR-${suiteId}-B` }, select: { id: true } });

  await prisma.itemReorderRule.createMany({
    data: [
      { tenantId: tenantA.id, itemId: itmA.id, warehouseId: whA.id, reorderLevel: '10.00', reorderQty: '50.00' },
      { tenantId: tenantB.id, itemId: itmB.id, warehouseId: whB.id, reorderLevel: '10.00', reorderQty: '50.00' },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /item-reorder-rules (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/item-reorder-rules");
    expect(res.status).toBe(200);
    const values = (res.body as { itemId: unknown }[]).map((r) => String(r.itemId));
    expect(values).toContain(`${itmA.id}`);
    expect(values).not.toContain(`${itmB.id}`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/item-reorder-rules");
    expect(res.status).toBe(200);
    const values = (res.body as { itemId: unknown }[]).map((r) => String(r.itemId));
    expect(values).toContain(`${itmB.id}`);
    expect(values).not.toContain(`${itmA.id}`);
  });
});
