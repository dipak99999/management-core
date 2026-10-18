// Real-DB integration test for the expense-claim-types router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { expenseClaimTypeRouter } = await import("./expense-claim-types");
  const app = express();
  app.use(express.json());
  app.use("/expense-claim-types", expenseClaimTypeRouter);
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

  await prisma.expenseClaimType.createMany({
    data: [
      { tenantId: tenantA.id, typeName: `ECT-${suiteId}-A` },
      { tenantId: tenantB.id, typeName: `ECT-${suiteId}-B` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /expense-claim-types (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/expense-claim-types");
    expect(res.status).toBe(200);
    const values = (res.body as { typeName: unknown }[]).map((r) => String(r.typeName));
    expect(values).toContain(`ECT-${suiteId}-A`);
    expect(values).not.toContain(`ECT-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/expense-claim-types");
    expect(res.status).toBe(200);
    const values = (res.body as { typeName: unknown }[]).map((r) => String(r.typeName));
    expect(values).toContain(`ECT-${suiteId}-B`);
    expect(values).not.toContain(`ECT-${suiteId}-A`);
  });
});
