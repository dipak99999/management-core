// Real-DB integration test for the ops router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { featureFlagRouter } = await import("./ops");
  const app = express();
  app.use(express.json());
  app.use("/ops/feature-flags", featureFlagRouter);
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

  await prisma.featureFlag.createMany({
    data: [
      { tenantId: tenantA.id, key: `flag-a-${suiteId}`, label: `FF-${suiteId}-A` },
      { tenantId: tenantB.id, key: `flag-b-${suiteId}`, label: `FF-${suiteId}-B` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /ops/feature-flags (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/ops/feature-flags");
    expect(res.status).toBe(200);
    const values = (res.body as { label: unknown }[]).map((r) => String(r.label));
    expect(values).toContain(`FF-${suiteId}-A`);
    expect(values).not.toContain(`FF-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/ops/feature-flags");
    expect(res.status).toBe(200);
    const values = (res.body as { label: unknown }[]).map((r) => String(r.label));
    expect(values).toContain(`FF-${suiteId}-B`);
    expect(values).not.toContain(`FF-${suiteId}-A`);
  });
});
