// Real-DB integration test for the repost-item-valuations router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-riv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { repostItemValuationRouter } = await import("./repost-item-valuations");
  const app = express();
  app.use(express.json());
  app.use("/repost-item-valuations", repostItemValuationRouter);
  return app;
}

let itA: { id: string };
let whA: { id: string };
let itB: { id: string };
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
  itA = await prisma.item.create({ data: { tenantId: tenantA.id, itemCode: `ITM-RIV-${suiteId}-A`, itemName: 'A' }, select: { id: true } });
  whA = await prisma.warehouse.create({ data: { tenantId: tenantA.id, warehouseName: `WH-RIV-${suiteId}-A` }, select: { id: true } });
  itB = await prisma.item.create({ data: { tenantId: tenantB.id, itemCode: `ITM-RIV-${suiteId}-B`, itemName: 'B' }, select: { id: true } });
  whB = await prisma.warehouse.create({ data: { tenantId: tenantB.id, warehouseName: `WH-RIV-${suiteId}-B` }, select: { id: true } });

  await prisma.repostItemValuation.createMany({
    data: [
      { tenantId: tenantA.id, itemId: itA.id, warehouseId: whA.id, fromDate: new Date('2026-01-01') },
      { tenantId: tenantB.id, itemId: itB.id, warehouseId: whB.id, fromDate: new Date('2026-01-01') },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /repost-item-valuations (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/repost-item-valuations");
    expect(res.status).toBe(200);
    const values = (res.body as { itemId: unknown }[]).map((r) => String(r.itemId));
    expect(values).toContain(`${itA.id}`);
    expect(values).not.toContain(`${itB.id}`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/repost-item-valuations");
    expect(res.status).toBe(200);
    const values = (res.body as { itemId: unknown }[]).map((r) => String(r.itemId));
    expect(values).toContain(`${itB.id}`);
    expect(values).not.toContain(`${itA.id}`);
  });
});
