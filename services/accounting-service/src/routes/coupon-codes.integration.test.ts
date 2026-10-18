// Real-DB integration test for the coupon-codes router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-cc2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { couponCodeRouter } = await import("./coupon-codes");
  const app = express();
  app.use(express.json());
  app.use("/coupon-codes", couponCodeRouter);
  return app;
}

let prA: { id: string };
let prB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  prA = await prisma.pricingRule.create({ data: { tenantId: tenantA.id, title: `PR-CC-${suiteId}-A` }, select: { id: true } });
  prB = await prisma.pricingRule.create({ data: { tenantId: tenantB.id, title: `PR-CC-${suiteId}-B` }, select: { id: true } });

  await prisma.couponCode.createMany({
    data: [
      { tenantId: tenantA.id, code: `CC-${suiteId}-A`, pricingRuleId: prA.id },
      { tenantId: tenantB.id, code: `CC-${suiteId}-B`, pricingRuleId: prB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /coupon-codes (real DB)", () => {
  it("returns only tenant A's rows", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/coupon-codes");
    expect(res.status).toBe(200);
    const values = (res.body as { code: unknown }[]).map((r) => String(r.code));
    expect(values).toContain(`CC-${suiteId}-A`);
    expect(values).not.toContain(`CC-${suiteId}-B`);
  });

  it("returns only tenant B's rows", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/coupon-codes");
    expect(res.status).toBe(200);
    const values = (res.body as { code: unknown }[]).map((r) => String(r.code));
    expect(values).toContain(`CC-${suiteId}-B`);
    expect(values).not.toContain(`CC-${suiteId}-A`);
  });
});
