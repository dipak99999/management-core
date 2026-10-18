// Real-DB integration test for the sales-orders router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-so-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { salesOrderRouter } = await import("./sales-orders");
  const app = express();
  app.use(express.json());
  app.use("/sales-orders", salesOrderRouter);
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
  custA = await prisma.customer.create({ data: { tenantId: tenantA.id, customerName: `SO-Cust-${suiteId}-A` }, select: { id: true } });
  custB = await prisma.customer.create({ data: { tenantId: tenantB.id, customerName: `SO-Cust-${suiteId}-B` }, select: { id: true } });

  await prisma.salesOrder.createMany({
    data: [
      { tenantId: tenantA.id, name: `SO-${suiteId}-A1`, customerId: custA.id },
      { tenantId: tenantB.id, name: `SO-${suiteId}-B1`, customerId: custB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /sales-orders (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/sales-orders");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`SO-${suiteId}-A1`);
    expect(values).not.toContain(`SO-${suiteId}-B1`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/sales-orders");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`SO-${suiteId}-B1`);
    expect(values).not.toContain(`SO-${suiteId}-A1`);
  });
});
