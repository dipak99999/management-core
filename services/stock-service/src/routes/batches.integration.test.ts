// Real-DB integration test for the batches router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-bt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { batchRouter } = await import("./batches");
  const app = express();
  app.use(express.json());
  app.use("/batches", batchRouter);
  return app;
}

let itemA: { id: string };
let itemB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  itemA = await prisma.item.create({
    data: { tenantId: tenantA.id, itemCode: `ITM-BT-${suiteId}-A`, itemName: "Widget A" },
    select: { id: true },
  });
  itemB = await prisma.item.create({
    data: { tenantId: tenantB.id, itemCode: `ITM-BT-${suiteId}-B`, itemName: "Widget B" },
    select: { id: true },
  });
  await prisma.batch.createMany({
    data: [
      { tenantId: tenantA.id, itemId: itemA.id, batchNo: `BATCH-${suiteId}-A1` },
      { tenantId: tenantB.id, itemId: itemB.id, batchNo: `BATCH-${suiteId}-B1` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /batches (real DB)", () => {
  it("returns only tenant A's batches", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/batches");
    expect(res.status).toBe(200);
    const nos = (res.body as { batchNo: string }[]).map((r) => r.batchNo);
    expect(nos).toContain(`BATCH-${suiteId}-A1`);
    expect(nos).not.toContain(`BATCH-${suiteId}-B1`);
  });

  it("returns only tenant B's batches", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/batches");
    expect(res.status).toBe(200);
    const nos = (res.body as { batchNo: string }[]).map((r) => r.batchNo);
    expect(nos).toContain(`BATCH-${suiteId}-B1`);
    expect(nos).not.toContain(`BATCH-${suiteId}-A1`);
  });
});
