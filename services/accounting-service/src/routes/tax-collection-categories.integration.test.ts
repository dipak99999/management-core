// Real-DB integration test for the tax-collection-categories router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-tcc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { taxCollectionCategoryRouter } = await import("./tax-collection-categories");
  const app = express();
  app.use(express.json());
  app.use("/tax-collection-categories", taxCollectionCategoryRouter);
  return app;
}

let acctA: { id: string };
let acctB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  acctA = await prisma.account.create({ data: { tenantId: tenantA.id, accountName: `TCS-${suiteId}-A`, rootType: 'Income' }, select: { id: true } });
  acctB = await prisma.account.create({ data: { tenantId: tenantB.id, accountName: `TCS-${suiteId}-B`, rootType: 'Income' }, select: { id: true } });

  await prisma.taxCollectionCategory.createMany({
    data: [
      { tenantId: tenantA.id, name: `TCC-${suiteId}-A`, rate: '0.10', accountId: acctA.id },
      { tenantId: tenantB.id, name: `TCC-${suiteId}-B`, rate: '0.10', accountId: acctB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /tax-collection-categories (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/tax-collection-categories");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`TCC-${suiteId}-A`);
    expect(values).not.toContain(`TCC-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/tax-collection-categories");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`TCC-${suiteId}-B`);
    expect(values).not.toContain(`TCC-${suiteId}-A`);
  });
});
