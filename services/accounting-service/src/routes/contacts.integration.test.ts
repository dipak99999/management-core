// Real-DB integration test for the contacts router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ctc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { contactRouter } = await import("./contacts");
  const app = express();
  app.use(express.json());
  app.use("/contacts", contactRouter);
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
  custA = await prisma.customer.create({ data: { tenantId: tenantA.id, customerName: `Ctc-Cust-${suiteId}-A` }, select: { id: true } });
  custB = await prisma.customer.create({ data: { tenantId: tenantB.id, customerName: `Ctc-Cust-${suiteId}-B` }, select: { id: true } });

  await prisma.contact.createMany({
    data: [
      { tenantId: tenantA.id, linkedDoctype: 'Customer', linkedId: custA.id, firstName: `Alice-${suiteId}` },
      { tenantId: tenantB.id, linkedDoctype: 'Customer', linkedId: custB.id, firstName: `Bob-${suiteId}` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /contacts (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/contacts");
    expect(res.status).toBe(200);
    const values = (res.body as { firstName: unknown }[]).map((r) => String(r.firstName));
    expect(values).toContain(`Alice-${suiteId}`);
    expect(values).not.toContain(`Bob-${suiteId}`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/contacts");
    expect(res.status).toBe(200);
    const values = (res.body as { firstName: unknown }[]).map((r) => String(r.firstName));
    expect(values).toContain(`Bob-${suiteId}`);
    expect(values).not.toContain(`Alice-${suiteId}`);
  });
});
