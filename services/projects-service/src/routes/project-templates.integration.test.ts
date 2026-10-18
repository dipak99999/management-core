// Real-DB integration test for the project-templates router. See
// services/accounting-service/src/routes/customers.integration.test.ts for
// the full rationale.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const { projectTemplateRouter } = await import("./project-templates");
  const app = express();
  app.use(express.json());
  app.use("/project-templates", projectTemplateRouter);
  return app;
}

// structureJson is required (Json) — pass empty milestones/tasks so the row
// is valid but has no cross-model deps.
const EMPTY_STRUCTURE = { milestones: [], tasks: [] };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  await prisma.projectTemplate.createMany({
    data: [
      { tenantId: tenantA.id, name: "Onboarding (A)", structureJson: EMPTY_STRUCTURE },
      { tenantId: tenantA.id, name: "Kickoff (A)", structureJson: EMPTY_STRUCTURE },
      { tenantId: tenantB.id, name: "Onboarding (B)", structureJson: EMPTY_STRUCTURE },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /project-templates (real DB)", () => {
  it("returns only tenant A's templates", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/project-templates");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(expect.arrayContaining(["Kickoff (A)", "Onboarding (A)"]));
    expect(names).not.toContain("Onboarding (B)");
  });

  it("returns only tenant B's templates", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/project-templates");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((t) => t.name);
    expect(names).toContain("Onboarding (B)");
    expect(names).not.toContain("Kickoff (A)");
  });
});
