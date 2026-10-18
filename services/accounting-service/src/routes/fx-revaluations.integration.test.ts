// Real-DB integration test for the fx-revaluations router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-fxr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { fxRevalRouter } = await import("./fx-revaluations");
  const app = express();
  app.use(express.json());
  app.use("/fx-revaluations", fxRevalRouter);
  return app;
}


beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });

  await prisma.fxRevaluationRun.createMany({
    data: [
      { tenantId: tenantA.id, asOfDate: new Date('2026-03-31'), ratesJson: { A: 1 }, summaryJson: { note: `A-${suiteId}` } },
      { tenantId: tenantB.id, asOfDate: new Date('2026-03-31'), ratesJson: { B: 1 }, summaryJson: { note: `B-${suiteId}` } },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /fx-revaluations (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/fx-revaluations");
    expect(res.status).toBe(200);
    const notes = (res.body as { summaryJson: { note: string } }[]).map((r) => r.summaryJson.note);
    expect(notes).toContain(`A-${suiteId}`);
    expect(notes).not.toContain(`B-${suiteId}`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/fx-revaluations");
    expect(res.status).toBe(200);
    const notes = (res.body as { summaryJson: { note: string } }[]).map((r) => r.summaryJson.note);
    expect(notes).toContain(`B-${suiteId}`);
    expect(notes).not.toContain(`A-${suiteId}`);
  });
});
