// Real-DB integration test for the suppliers router. See
// services/accounting-service/src/routes/customers.integration.test.ts for
// the full rationale.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-sup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { supplierRouter } = await import("./suppliers");
  const app = express();
  app.use(express.json());
  app.use("/suppliers", supplierRouter);
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
  await prisma.supplier.createMany({
    data: [
      { tenantId: tenantA.id, supplierName: "Contoso (A)" },
      { tenantId: tenantA.id, supplierName: "Fabrikam (A)" },
      { tenantId: tenantB.id, supplierName: "Umbrella (B)" },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /suppliers (real DB)", () => {
  it("returns only tenant A's suppliers", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/suppliers");
    expect(res.status).toBe(200);
    const names = (res.body as { supplierName: string }[]).map((s) => s.supplierName).sort();
    expect(names).toEqual(expect.arrayContaining(["Contoso (A)", "Fabrikam (A)"]));
    expect(names).not.toContain("Umbrella (B)");
  });

  it("returns only tenant B's suppliers", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/suppliers");
    expect(res.status).toBe(200);
    const names = (res.body as { supplierName: string }[]).map((s) => s.supplierName);
    expect(names).toContain("Umbrella (B)");
    expect(names).not.toContain("Contoso (A)");
  });
});
