// Real-DB integration test for the territories router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-terr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { territoryRouter } = await import("./territories");
  const app = express();
  app.use(express.json());
  app.use("/territories", territoryRouter);
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

  await prisma.territory.createMany({
    data: [
      { tenantId: tenantA.id, territoryName: `Terr-${suiteId}-A` },
      { tenantId: tenantB.id, territoryName: `Terr-${suiteId}-B` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /territories (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/territories");
    expect(res.status).toBe(200);
    const values = (res.body as { territoryName: unknown }[]).map((r) => String(r.territoryName));
    expect(values).toContain(`Terr-${suiteId}-A`);
    expect(values).not.toContain(`Terr-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/territories");
    expect(res.status).toBe(200);
    const values = (res.body as { territoryName: unknown }[]).map((r) => String(r.territoryName));
    expect(values).toContain(`Terr-${suiteId}-B`);
    expect(values).not.toContain(`Terr-${suiteId}-A`);
  });
});
