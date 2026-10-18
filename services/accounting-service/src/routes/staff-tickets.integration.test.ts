// Real-DB integration test for the staff-tickets router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { staffTicketRouter } = await import("./staff-tickets");
  const app = express();
  app.use(express.json());
  app.use("/staff-tickets", staffTicketRouter);
  return app;
}

let puA: { id: string };
let puB: { id: string };
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
  custA = await prisma.customer.create({ data: { tenantId: tenantA.id, customerName: `PT-Cust-${suiteId}-A` }, select: { id: true } });
  custB = await prisma.customer.create({ data: { tenantId: tenantB.id, customerName: `PT-Cust-${suiteId}-B` }, select: { id: true } });
  puA = await prisma.portalUser.create({ data: { tenantId: tenantA.id, email: `pu-a-${suiteId}@x.com`, partyType: 'Customer', partyId: custA.id }, select: { id: true } });
  puB = await prisma.portalUser.create({ data: { tenantId: tenantB.id, email: `pu-b-${suiteId}@x.com`, partyType: 'Customer', partyId: custB.id }, select: { id: true } });

  await prisma.portalTicket.createMany({
    data: [
      { tenantId: tenantA.id, name: `PT-${suiteId}-A1`, portalUserId: puA.id, partyType: 'Customer', partyId: custA.id, subject: `Ticket-${suiteId}-A` },
      { tenantId: tenantB.id, name: `PT-${suiteId}-B1`, portalUserId: puB.id, partyType: 'Customer', partyId: custB.id, subject: `Ticket-${suiteId}-B` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /staff-tickets (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/staff-tickets");
    expect(res.status).toBe(200);
    const values = (res.body as { subject: unknown }[]).map((r) => String(r.subject));
    expect(values).toContain(`Ticket-${suiteId}-A`);
    expect(values).not.toContain(`Ticket-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/staff-tickets");
    expect(res.status).toBe(200);
    const values = (res.body as { subject: unknown }[]).map((r) => String(r.subject));
    expect(values).toContain(`Ticket-${suiteId}-B`);
    expect(values).not.toContain(`Ticket-${suiteId}-A`);
  });
});
