// Real-DB integration test for the payment-entries router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-pe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenantA: { id: string };
let tenantB: { id: string };
let currentTenantId: string;

vi.mock("@lumaara/service-auth", async () => {
  const actual = await vi.importActual<typeof import("@lumaara/service-auth")>(
    "@lumaara/service-auth",
  );
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: { tenantId: string; userId: string; role: string } }).auth = {
      tenantId: currentTenantId,
      userId: "user-test",
      role: "admin",
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
  const { paymentEntryRouter } = await import("./payment-entries");
  const app = express();
  app.use(express.json());
  app.use("/payment-entries", paymentEntryRouter);
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
  custA = await prisma.customer.create({
    data: { tenantId: tenantA.id, customerName: `PE-Cust-${suiteId}-A` },
    select: { id: true },
  });
  custB = await prisma.customer.create({
    data: { tenantId: tenantB.id, customerName: `PE-Cust-${suiteId}-B` },
    select: { id: true },
  });
  await prisma.paymentEntry.createMany({
    data: [
      {
        tenantId: tenantA.id, name: `PE-${suiteId}-A1`, paymentType: "Receive",
        partyType: "Customer", partyId: custA.id, paidAmount: "100.00",
      },
      {
        tenantId: tenantB.id, name: `PE-${suiteId}-B1`, paymentType: "Receive",
        partyType: "Customer", partyId: custB.id, paidAmount: "50.00",
      },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /payment-entries (real DB)", () => {
  it("returns only tenant A's payments", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/payment-entries");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`PE-${suiteId}-A1`);
    expect(names).not.toContain(`PE-${suiteId}-B1`);
  });

  it("returns only tenant B's payments", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/payment-entries");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`PE-${suiteId}-B1`);
    expect(names).not.toContain(`PE-${suiteId}-A1`);
  });
});
