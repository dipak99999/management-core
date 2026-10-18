// Real-DB integration test for the pos-opening router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-poso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { posOpeningRouter } = await import("./pos-opening");
  const app = express();
  app.use(express.json());
  app.use("/pos-opening", posOpeningRouter);
  return app;
}

let profA: { id: string };
let profB: { id: string };
let uA: { id: string };
let uB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  uA = await prisma.user.create({ data: { tenantId: tenantA.id, email: `posou-a-${suiteId}@x.com`, passwordHash: 'x', fullName: 'A' }, select: { id: true } });
  uB = await prisma.user.create({ data: { tenantId: tenantB.id, email: `posou-b-${suiteId}@x.com`, passwordHash: 'x', fullName: 'B' }, select: { id: true } });
  profA = await prisma.pOSProfile.create({ data: { tenantId: tenantA.id, name: `POSO-P-${suiteId}-A`, title: 'A', paymentMethods: [] }, select: { id: true } });
  profB = await prisma.pOSProfile.create({ data: { tenantId: tenantB.id, name: `POSO-P-${suiteId}-B`, title: 'B', paymentMethods: [] }, select: { id: true } });

  await prisma.pOSOpeningEntry.createMany({
    data: [
      { tenantId: tenantA.id, name: `POSO-${suiteId}-A1`, posProfileId: profA.id, userId: uA.id, openingBalances: {} },
      { tenantId: tenantB.id, name: `POSO-${suiteId}-B1`, posProfileId: profB.id, userId: uB.id, openingBalances: {} },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /pos-opening (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/pos-opening");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`POSO-${suiteId}-A1`);
    expect(values).not.toContain(`POSO-${suiteId}-B1`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/pos-opening");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`POSO-${suiteId}-B1`);
    expect(values).not.toContain(`POSO-${suiteId}-A1`);
  });
});
