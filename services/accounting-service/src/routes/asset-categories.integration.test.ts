// Real-DB integration test for the asset-categories router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { assetCategoryRouter } = await import("./asset-categories");
  const app = express();
  app.use(express.json());
  app.use("/asset-categories", assetCategoryRouter);
  return app;
}

let a1: { id: string };
let a2: { id: string };
let a3: { id: string };
let b1: { id: string };
let b2: { id: string };
let b3: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  a1 = await prisma.account.create({ data: { tenantId: tenantA.id, accountName: `AC1-${suiteId}-A`, rootType: 'Asset' }, select: { id: true } });
  a2 = await prisma.account.create({ data: { tenantId: tenantA.id, accountName: `AC2-${suiteId}-A`, rootType: 'Asset' }, select: { id: true } });
  a3 = await prisma.account.create({ data: { tenantId: tenantA.id, accountName: `AC3-${suiteId}-A`, rootType: 'Expense' }, select: { id: true } });
  b1 = await prisma.account.create({ data: { tenantId: tenantB.id, accountName: `AC1-${suiteId}-B`, rootType: 'Asset' }, select: { id: true } });
  b2 = await prisma.account.create({ data: { tenantId: tenantB.id, accountName: `AC2-${suiteId}-B`, rootType: 'Asset' }, select: { id: true } });
  b3 = await prisma.account.create({ data: { tenantId: tenantB.id, accountName: `AC3-${suiteId}-B`, rootType: 'Expense' }, select: { id: true } });

  await prisma.assetCategory.createMany({
    data: [
      { tenantId: tenantA.id, categoryName: `AC-${suiteId}-A`, assetAccountId: a1.id, accumDepreciationAccountId: a2.id, depExpenseAccountId: a3.id },
      { tenantId: tenantB.id, categoryName: `AC-${suiteId}-B`, assetAccountId: b1.id, accumDepreciationAccountId: b2.id, depExpenseAccountId: b3.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /asset-categories (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/asset-categories");
    expect(res.status).toBe(200);
    const values = (res.body as { categoryName: unknown }[]).map((r) => String(r.categoryName));
    expect(values).toContain(`AC-${suiteId}-A`);
    expect(values).not.toContain(`AC-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/asset-categories");
    expect(res.status).toBe(200);
    const values = (res.body as { categoryName: unknown }[]).map((r) => String(r.categoryName));
    expect(values).toContain(`AC-${suiteId}-B`);
    expect(values).not.toContain(`AC-${suiteId}-A`);
  });
});
