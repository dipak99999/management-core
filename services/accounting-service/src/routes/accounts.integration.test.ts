// Real-DB integration test for the accounts router — second router in
// accounting-service covered end-to-end. Same pattern as
// customers.integration.test.ts; kept minimal since the goal is to prove
// the tenant-isolation guarantee extends beyond just customers.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-acc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      read: pass,
      write: pass,
      create: pass,
      delete: pass,
      submit: pass,
      cancel: pass,
    }),
  };
});

async function buildApp() {
  const { accountRouter } = await import("./accounts");
  const app = express();
  app.use(express.json());
  app.use("/accounts", accountRouter);
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
  await prisma.account.createMany({
    data: [
      { tenantId: tenantA.id, accountName: "Cash (A)", rootType: "Asset", accountType: "Cash" },
      { tenantId: tenantA.id, accountName: "Bank (A)", rootType: "Asset", accountType: "Bank" },
      { tenantId: tenantB.id, accountName: "Cash (B)", rootType: "Asset", accountType: "Cash" },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.$disconnect();
});

describe("GET /accounts (real DB)", () => {
  it("returns only the calling tenant's accounts (A view)", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/accounts");
    expect(res.status).toBe(200);
    const names = (res.body as { accountName: string }[]).map((a) => a.accountName).sort();
    expect(names).toEqual(expect.arrayContaining(["Bank (A)", "Cash (A)"]));
    expect(names).not.toContain("Cash (B)");
  });

  it("returns only the calling tenant's accounts (B view)", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/accounts");
    expect(res.status).toBe(200);
    const names = (res.body as { accountName: string }[]).map((a) => a.accountName);
    expect(names).toContain("Cash (B)");
    expect(names).not.toContain("Cash (A)");
    expect(names).not.toContain("Bank (A)");
  });
});
