// Real-DB integration test for the delivery-notes router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-dn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { deliveryNoteRouter } = await import("./delivery-notes");
  const app = express();
  app.use(express.json());
  app.use("/delivery-notes", deliveryNoteRouter);
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
    data: { tenantId: tenantA.id, customerName: `DN-Cust-${suiteId}-A` },
    select: { id: true },
  });
  custB = await prisma.customer.create({
    data: { tenantId: tenantB.id, customerName: `DN-Cust-${suiteId}-B` },
    select: { id: true },
  });
  await prisma.deliveryNote.createMany({
    data: [
      { tenantId: tenantA.id, name: `DN-${suiteId}-A1`, customerId: custA.id },
      { tenantId: tenantB.id, name: `DN-${suiteId}-B1`, customerId: custB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /delivery-notes (real DB)", () => {
  it("returns only tenant A's notes", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/delivery-notes");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`DN-${suiteId}-A1`);
    expect(names).not.toContain(`DN-${suiteId}-B1`);
  });

  it("returns only tenant B's notes", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/delivery-notes");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`DN-${suiteId}-B1`);
    expect(names).not.toContain(`DN-${suiteId}-A1`);
  });
});
