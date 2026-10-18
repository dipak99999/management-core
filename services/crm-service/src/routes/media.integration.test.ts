// Real-DB integration test for the media router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-med-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { mediaRouter } = await import("./media");
  const app = express();
  app.use(express.json());
  app.use("/media", mediaRouter);
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

  await prisma.mediaAsset.createMany({
    data: [
      { tenantId: tenantA.id, filename: `media-a-${suiteId}.png`, storageKey: `mkey-a-${suiteId}`, contentType: 'image/png', sizeBytes: 100, sha256: 'a'.repeat(64) },
      { tenantId: tenantB.id, filename: `media-b-${suiteId}.png`, storageKey: `mkey-b-${suiteId}`, contentType: 'image/png', sizeBytes: 100, sha256: 'b'.repeat(64) },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /media (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/media");
    expect(res.status).toBe(200);
    const values = (res.body as { filename: unknown }[]).map((r) => String(r.filename));
    expect(values).toContain(`media-a-${suiteId}.png`);
    expect(values).not.toContain(`media-b-${suiteId}.png`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/media");
    expect(res.status).toBe(200);
    const values = (res.body as { filename: unknown }[]).map((r) => String(r.filename));
    expect(values).toContain(`media-b-${suiteId}.png`);
    expect(values).not.toContain(`media-a-${suiteId}.png`);
  });
});
