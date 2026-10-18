// Real-DB integration test for the pos-profiles router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-posp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { posProfileRouter } = await import("./pos-profiles");
  const app = express();
  app.use(express.json());
  app.use("/pos-profiles", posProfileRouter);
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

  await prisma.pOSProfile.createMany({
    data: [
      { tenantId: tenantA.id, name: `POSP-${suiteId}-A`, title: `Profile-${suiteId}-A`, paymentMethods: [] },
      { tenantId: tenantB.id, name: `POSP-${suiteId}-B`, title: `Profile-${suiteId}-B`, paymentMethods: [] },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /pos-profiles (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/pos-profiles");
    expect(res.status).toBe(200);
    const values = (res.body as { title: unknown }[]).map((r) => String(r.title));
    expect(values).toContain(`Profile-${suiteId}-A`);
    expect(values).not.toContain(`Profile-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/pos-profiles");
    expect(res.status).toBe(200);
    const values = (res.body as { title: unknown }[]).map((r) => String(r.title));
    expect(values).toContain(`Profile-${suiteId}-B`);
    expect(values).not.toContain(`Profile-${suiteId}-A`);
  });
});
