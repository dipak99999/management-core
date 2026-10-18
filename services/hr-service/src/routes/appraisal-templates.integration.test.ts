// Real-DB integration test for the appraisal-templates router. See
// services/accounting-service/src/routes/customers.integration.test.ts for
// the full rationale.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { appraisalTemplateRouter } = await import("./appraisals");
  const app = express();
  app.use(express.json());
  app.use("/appraisal-templates", appraisalTemplateRouter);
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
  await prisma.appraisalTemplate.createMany({
    data: [
      { tenantId: tenantA.id, name: "Annual (A)" },
      { tenantId: tenantA.id, name: "Quarterly (A)" },
      { tenantId: tenantB.id, name: "Annual (B)" },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /appraisal-templates (real DB)", () => {
  it("returns only tenant A's templates", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/appraisal-templates");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(expect.arrayContaining(["Annual (A)", "Quarterly (A)"]));
    expect(names).not.toContain("Annual (B)");
  });

  it("returns only tenant B's templates", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/appraisal-templates");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((t) => t.name);
    expect(names).toContain("Annual (B)");
    expect(names).not.toContain("Annual (A)");
    expect(names).not.toContain("Quarterly (A)");
  });
});
