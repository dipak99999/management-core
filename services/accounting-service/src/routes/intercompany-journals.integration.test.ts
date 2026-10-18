// Real-DB integration test for the intercompany-journals router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-icj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { intercompanyJournalRouter } = await import("./intercompany-journals");
  const app = express();
  app.use(express.json());
  app.use("/intercompany-journals", intercompanyJournalRouter);
  return app;
}

let coA1: { id: string };
let coA2: { id: string };
let coB1: { id: string };
let coB2: { id: string };
let jeA1: { id: string };
let jeA2: { id: string };
let jeB1: { id: string };
let jeB2: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  coA1 = await prisma.company.create({ data: { tenantId: tenantA.id, name: `Co1-${suiteId}-A`, code: `A1${Date.now().toString(36).slice(-5)}` }, select: { id: true } });
  coA2 = await prisma.company.create({ data: { tenantId: tenantA.id, name: `Co2-${suiteId}-A`, code: `A2${Date.now().toString(36).slice(-5)}` }, select: { id: true } });
  coB1 = await prisma.company.create({ data: { tenantId: tenantB.id, name: `Co1-${suiteId}-B`, code: `B1${Date.now().toString(36).slice(-5)}` }, select: { id: true } });
  coB2 = await prisma.company.create({ data: { tenantId: tenantB.id, name: `Co2-${suiteId}-B`, code: `B2${Date.now().toString(36).slice(-5)}` }, select: { id: true } });
  jeA1 = await prisma.journalEntry.create({ data: { tenantId: tenantA.id, name: `JE-IC1-${suiteId}-A` }, select: { id: true } });
  jeA2 = await prisma.journalEntry.create({ data: { tenantId: tenantA.id, name: `JE-IC2-${suiteId}-A` }, select: { id: true } });
  jeB1 = await prisma.journalEntry.create({ data: { tenantId: tenantB.id, name: `JE-IC1-${suiteId}-B` }, select: { id: true } });
  jeB2 = await prisma.journalEntry.create({ data: { tenantId: tenantB.id, name: `JE-IC2-${suiteId}-B` }, select: { id: true } });

  await prisma.intercompanyJournalEntry.createMany({
    data: [
      { tenantId: tenantA.id, fromCompanyId: coA1.id, toCompanyId: coA2.id, fromJournalId: jeA1.id, toJournalId: jeA2.id, amount: '1000', postingDate: new Date('2026-01-15') },
      { tenantId: tenantB.id, fromCompanyId: coB1.id, toCompanyId: coB2.id, fromJournalId: jeB1.id, toJournalId: jeB2.id, amount: '1000', postingDate: new Date('2026-01-15') },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /intercompany-journals (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/intercompany-journals");
    expect(res.status).toBe(200);
    const values = (res.body as { fromCompanyId: unknown }[]).map((r) => String(r.fromCompanyId));
    expect(values).toContain(`${coA1.id}`);
    expect(values).not.toContain(`${coB1.id}`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/intercompany-journals");
    expect(res.status).toBe(200);
    const values = (res.body as { fromCompanyId: unknown }[]).map((r) => String(r.fromCompanyId));
    expect(values).toContain(`${coB1.id}`);
    expect(values).not.toContain(`${coA1.id}`);
  });
});
