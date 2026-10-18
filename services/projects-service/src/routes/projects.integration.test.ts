// Real-database integration test for GET /projects. See
// services/accounting-service/src/routes/customers.integration.test.ts for
// the full rationale.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      read: pass,
      write: pass,
      create: pass,
      delete: pass,
      submit: pass,
      cancel: pass,
    }),
  };
});

async function buildApp() {
  const { projectRouter } = await import("./projects");
  const app = express();
  app.use(express.json());
  app.use("/projects", projectRouter);
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
  await prisma.project.createMany({
    data: [
      { tenantId: tenantA.id, name: "PROJ-A01", projectName: "Alpha" },
      { tenantId: tenantA.id, name: "PROJ-A02", projectName: "Bravo" },
      { tenantId: tenantB.id, name: "PROJ-B01", projectName: "Charlie" },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.$disconnect();
});

describe("GET /projects (real DB)", () => {
  it("returns only the calling tenant's projects (tenant A view)", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
    const names = (res.body as { projectName: string }[]).map((p) => p.projectName).sort();
    expect(names).toEqual(expect.arrayContaining(["Alpha", "Bravo"]));
    expect(names).not.toContain("Charlie");
  });

  it("returns only the calling tenant's projects (tenant B view)", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
    const names = (res.body as { projectName: string }[]).map((p) => p.projectName);
    expect(names).toContain("Charlie");
    expect(names).not.toContain("Alpha");
    expect(names).not.toContain("Bravo");
  });
});

describe("PUT /projects/:id (real DB — cross-tenant IDOR check)", () => {
  it("tenant A cannot update tenant B's project — returns 404", async () => {
    const target = await prisma.project.findFirst({
      where: { tenantId: tenantB.id, projectName: "Charlie" },
      select: { id: true },
    });
    expect(target).not.toBeNull();

    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app)
      .put(`/projects/${target!.id}`)
      .send({ projectName: "HIJACKED" });
    expect(res.status).toBe(404);

    const after = await prisma.project.findUnique({ where: { id: target!.id } });
    expect(after?.projectName).toBe("Charlie");
  });
});
