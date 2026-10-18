// Real-DB integration test for the assets router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { assetRouter } = await import("./assets");
  const app = express();
  app.use(express.json());
  app.use("/assets", assetRouter);
  return app;
}

let acA: { id: string };
let acB: { id: string };
let catA: { id: string };
let catB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  acA = await prisma.account.create({ data: { tenantId: tenantA.id, accountName: `AA-${suiteId}-A`, rootType: 'Asset' }, select: { id: true } });
  acB = await prisma.account.create({ data: { tenantId: tenantB.id, accountName: `AA-${suiteId}-B`, rootType: 'Asset' }, select: { id: true } });
  catA = await prisma.assetCategory.create({ data: { tenantId: tenantA.id, categoryName: `Cat-${suiteId}-A`, assetAccountId: acA.id, accumDepreciationAccountId: acA.id, depExpenseAccountId: acA.id }, select: { id: true } });
  catB = await prisma.assetCategory.create({ data: { tenantId: tenantB.id, categoryName: `Cat-${suiteId}-B`, assetAccountId: acB.id, accumDepreciationAccountId: acB.id, depExpenseAccountId: acB.id }, select: { id: true } });

  await prisma.asset.createMany({
    data: [
      { tenantId: tenantA.id, assetCode: `AST-${suiteId}-A`, assetName: `Asset-${suiteId}-A`, categoryId: catA.id, purchaseDate: new Date('2026-01-01'), purchasePrice: '1000', usefulLifeMonths: 36, currentValue: '1000' },
      { tenantId: tenantB.id, assetCode: `AST-${suiteId}-B`, assetName: `Asset-${suiteId}-B`, categoryId: catB.id, purchaseDate: new Date('2026-01-01'), purchasePrice: '1000', usefulLifeMonths: 36, currentValue: '1000' },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /assets (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/assets");
    expect(res.status).toBe(200);
    const values = (res.body as { assetCode: unknown }[]).map((r) => String(r.assetCode));
    expect(values).toContain(`AST-${suiteId}-A`);
    expect(values).not.toContain(`AST-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/assets");
    expect(res.status).toBe(200);
    const values = (res.body as { assetCode: unknown }[]).map((r) => String(r.assetCode));
    expect(values).toContain(`AST-${suiteId}-B`);
    expect(values).not.toContain(`AST-${suiteId}-A`);
  });
});
