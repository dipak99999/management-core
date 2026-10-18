// Real-DB integration test for the item-uom-conversions router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-iuc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { itemUOMConversionRouter } = await import("./item-uom-conversions");
  const app = express();
  app.use(express.json());
  app.use("/item-uom-conversions", itemUOMConversionRouter);
  return app;
}

let itA: { id: string };
let itB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  itA = await prisma.item.create({ data: { tenantId: tenantA.id, itemCode: `ITM-UOM-${suiteId}-A`, itemName: 'A' }, select: { id: true } });
  itB = await prisma.item.create({ data: { tenantId: tenantB.id, itemCode: `ITM-UOM-${suiteId}-B`, itemName: 'B' }, select: { id: true } });

  await prisma.itemUOMConversion.createMany({
    data: [
      { tenantId: tenantA.id, itemId: itA.id, uom: `Box-${suiteId}-A`, conversionFactor: '12.00' },
      { tenantId: tenantB.id, itemId: itB.id, uom: `Box-${suiteId}-B`, conversionFactor: '12.00' },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /item-uom-conversions (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/item-uom-conversions");
    expect(res.status).toBe(200);
    const values = (res.body as { uom: unknown }[]).map((r) => String(r.uom));
    expect(values).toContain(`Box-${suiteId}-A`);
    expect(values).not.toContain(`Box-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/item-uom-conversions");
    expect(res.status).toBe(200);
    const values = (res.body as { uom: unknown }[]).map((r) => String(r.uom));
    expect(values).toContain(`Box-${suiteId}-B`);
    expect(values).not.toContain(`Box-${suiteId}-A`);
  });
});
