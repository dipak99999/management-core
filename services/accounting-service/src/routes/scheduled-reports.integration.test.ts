// Real-DB integration test for the scheduled-reports router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-srp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { scheduledReportRouter } = await import("./scheduled-reports");
  const app = express();
  app.use(express.json());
  app.use("/scheduled-reports", scheduledReportRouter);
  return app;
}

let srA: { id: string };
let srB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  srA = await prisma.savedReport.create({ data: { tenantId: tenantA.id, name: `SR-${suiteId}-A`, doctype: 'Customer', ownerUserId: 'user-test', definition: {} }, select: { id: true } });
  srB = await prisma.savedReport.create({ data: { tenantId: tenantB.id, name: `SR-${suiteId}-B`, doctype: 'Customer', ownerUserId: 'user-test', definition: {} }, select: { id: true } });

  await prisma.scheduledReport.createMany({
    data: [
      { tenantId: tenantA.id, name: `Sched-${suiteId}-A`, savedReportId: srA.id, frequency: 'Weekly', emailTo: 'a@x.com' },
      { tenantId: tenantB.id, name: `Sched-${suiteId}-B`, savedReportId: srB.id, frequency: 'Weekly', emailTo: 'b@x.com' },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /scheduled-reports (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/scheduled-reports");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`Sched-${suiteId}-A`);
    expect(values).not.toContain(`Sched-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/scheduled-reports");
    expect(res.status).toBe(200);
    const values = (res.body as { name: unknown }[]).map((r) => String(r.name));
    expect(values).toContain(`Sched-${suiteId}-B`);
    expect(values).not.toContain(`Sched-${suiteId}-A`);
  });
});
