// Real-DB integration test for the meeting-types router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-mt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { meetingTypeRouter } = await import("./meeting-types");
  const app = express();
  app.use(express.json());
  app.use("/meeting-types", meetingTypeRouter);
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

  await prisma.meetingType.createMany({
    data: [
      { tenantId: tenantA.id, ownerUserId: 'user-test', slug: `mt-a-${suiteId}`, title: `MT-${suiteId}-A`, durationMinutes: 30 },
      { tenantId: tenantB.id, ownerUserId: 'user-test', slug: `mt-b-${suiteId}`, title: `MT-${suiteId}-B`, durationMinutes: 30 },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /meeting-types (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/meeting-types");
    expect(res.status).toBe(200);
    const values = (res.body as { title: unknown }[]).map((r) => String(r.title));
    expect(values).toContain(`MT-${suiteId}-A`);
    expect(values).not.toContain(`MT-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/meeting-types");
    expect(res.status).toBe(200);
    const values = (res.body as { title: unknown }[]).map((r) => String(r.title));
    expect(values).toContain(`MT-${suiteId}-B`);
    expect(values).not.toContain(`MT-${suiteId}-A`);
  });
});
