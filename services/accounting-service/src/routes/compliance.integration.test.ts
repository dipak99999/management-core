// Real-DB integration test for the audit-log list on the compliance router.
//
// NOTE: an earlier run of this test surfaced schema drift — audit_logs was
// missing prevHash/entryHash/sequence columns. Fixed by migration
// 20260929000000_audit_log_hash_chain. That's why this test exists: it
// exercises the exact code path where the drift bit.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { auditRouter } = await import("./compliance");
  const app = express();
  app.use(express.json());
  app.use("/audit", auditRouter);
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
  await prisma.auditLog.createMany({
    data: [
      { tenantId: tenantA.id, method: "GET", path: `/A-${suiteId}`, statusCode: 200 },
      { tenantId: tenantB.id, method: "GET", path: `/B-${suiteId}`, statusCode: 200 },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /audit (real DB)", () => {
  it("returns only tenant A's audit rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/audit");
    expect(res.status).toBe(200);
    const paths = (res.body as { path: string }[]).map((r) => r.path);
    expect(paths).toContain(`/A-${suiteId}`);
    expect(paths).not.toContain(`/B-${suiteId}`);
  });

  it("returns only tenant B's audit rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/audit");
    expect(res.status).toBe(200);
    const paths = (res.body as { path: string }[]).map((r) => r.path);
    expect(paths).toContain(`/B-${suiteId}`);
    expect(paths).not.toContain(`/A-${suiteId}`);
  });
});
