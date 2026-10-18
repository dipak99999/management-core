// Real-DB integration test for the warehouses router. See
// services/accounting-service/src/routes/customers.integration.test.ts for
// the full rationale.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { warehouseRouter } = await import("./warehouses");
  const app = express();
  app.use(express.json());
  app.use("/warehouses", warehouseRouter);
  return app;
}

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  await prisma.warehouse.createMany({
    data: [
      { tenantId: tenantA.id, warehouseName: "Main WH (A)" },
      { tenantId: tenantA.id, warehouseName: "Backup WH (A)" },
      { tenantId: tenantB.id, warehouseName: "Main WH (B)" },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /warehouses (real DB)", () => {
  it("returns only tenant A's warehouses", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/warehouses");
    expect(res.status).toBe(200);
    const names = (res.body as { warehouseName: string }[]).map((w) => w.warehouseName).sort();
    expect(names).toEqual(expect.arrayContaining(["Backup WH (A)", "Main WH (A)"]));
    expect(names).not.toContain("Main WH (B)");
  });

  it("returns only tenant B's warehouses", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/warehouses");
    expect(res.status).toBe(200);
    const names = (res.body as { warehouseName: string }[]).map((w) => w.warehouseName);
    expect(names).toContain("Main WH (B)");
    expect(names).not.toContain("Main WH (A)");
  });
});
