// Real-DB integration test for the addresses router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-adr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { addressRouter } = await import("./addresses");
  const app = express();
  app.use(express.json());
  app.use("/addresses", addressRouter);
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
  custA = await prisma.customer.create({ data: { tenantId: tenantA.id, customerName: `Addr-Cust-${suiteId}-A` }, select: { id: true } });
  custB = await prisma.customer.create({ data: { tenantId: tenantB.id, customerName: `Addr-Cust-${suiteId}-B` }, select: { id: true } });

  await prisma.address.createMany({
    data: [
      { tenantId: tenantA.id, linkedDoctype: 'Customer', linkedId: custA.id, addressLine1: `Line1-${suiteId}-A` },
      { tenantId: tenantB.id, linkedDoctype: 'Customer', linkedId: custB.id, addressLine1: `Line1-${suiteId}-B` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /addresses (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/addresses");
    expect(res.status).toBe(200);
    const values = (res.body as { addressLine1: unknown }[]).map((r) => String(r.addressLine1));
    expect(values).toContain(`Line1-${suiteId}-A`);
    expect(values).not.toContain(`Line1-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/addresses");
    expect(res.status).toBe(200);
    const values = (res.body as { addressLine1: unknown }[]).map((r) => String(r.addressLine1));
    expect(values).toContain(`Line1-${suiteId}-B`);
    expect(values).not.toContain(`Line1-${suiteId}-A`);
  });
});
