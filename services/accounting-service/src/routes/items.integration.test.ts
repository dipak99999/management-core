// Real-DB integration test for the items router. See
// services/accounting-service/src/routes/customers.integration.test.ts for
// the full rationale.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-items-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { itemRouter } = await import("./items");
  const app = express();
  app.use(express.json());
  app.use("/items", itemRouter);
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
  await prisma.item.createMany({
    data: [
      { tenantId: tenantA.id, itemCode: "ITM-IT-A01", itemName: "Widget A1" },
      { tenantId: tenantA.id, itemCode: "ITM-IT-A02", itemName: "Widget A2" },
      { tenantId: tenantB.id, itemCode: "ITM-IT-B01", itemName: "Widget B1" },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /items (real DB)", () => {
  it("returns only tenant A's items", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    const codes = (res.body as { itemCode: string }[]).map((i) => i.itemCode).sort();
    expect(codes).toEqual(expect.arrayContaining(["ITM-IT-A01", "ITM-IT-A02"]));
    expect(codes).not.toContain("ITM-IT-B01");
  });

  it("returns only tenant B's items", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    const codes = (res.body as { itemCode: string }[]).map((i) => i.itemCode);
    expect(codes).toContain("ITM-IT-B01");
    expect(codes).not.toContain("ITM-IT-A01");
  });
});
