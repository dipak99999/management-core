// Real-DB integration test for the boms router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-bom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { bomRouter } = await import("./boms");
  const app = express();
  app.use(express.json());
  app.use("/boms", bomRouter);
  return app;
}

let itmA: { id: string };
let itmB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  itmA = await prisma.item.create({ data: { tenantId: tenantA.id, itemCode: `ITM-BOM-${suiteId}-A`, itemName: 'A' }, select: { id: true } });
  itmB = await prisma.item.create({ data: { tenantId: tenantB.id, itemCode: `ITM-BOM-${suiteId}-B`, itemName: 'B' }, select: { id: true } });

  await prisma.bOM.createMany({
    data: [
      { tenantId: tenantA.id, name: `BOM-${suiteId}-A1`, productionItemId: itmA.id },
      { tenantId: tenantB.id, name: `BOM-${suiteId}-B1`, productionItemId: itmB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /boms (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/boms");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`BOM-${suiteId}-A1`);
    expect(values).not.toContain(`BOM-${suiteId}-B1`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/boms");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`BOM-${suiteId}-B1`);
    expect(values).not.toContain(`BOM-${suiteId}-A1`);
  });
});
