// Real-database integration test for GET /employees. See
// services/accounting-service/src/routes/customers.integration.test.ts for
// the full rationale — the summary: mocks can only verify a syntactic
// tenantId filter is present; this exercises real Prisma queries against a
// dedicated lumaara_test DB, so a broken WHERE clause would actually leak.

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
  const { employeeRouter } = await import("./employees");
  const app = express();
  app.use(express.json());
  app.use("/employees", employeeRouter);
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
  await prisma.employee.createMany({
    data: [
      { tenantId: tenantA.id, employeeCode: "EMP-A01", employeeName: "Alice" },
      { tenantId: tenantA.id, employeeCode: "EMP-A02", employeeName: "Bob" },
      { tenantId: tenantB.id, employeeCode: "EMP-B01", employeeName: "Carol" },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.$disconnect();
});

describe("GET /employees (real DB)", () => {
  it("returns only the calling tenant's employees (tenant A view)", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/employees");
    expect(res.status).toBe(200);
    const names = (res.body as { employeeName: string }[]).map((e) => e.employeeName).sort();
    expect(names).toEqual(expect.arrayContaining(["Alice", "Bob"]));
    expect(names).not.toContain("Carol");
  });

  it("returns only the calling tenant's employees (tenant B view)", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/employees");
    expect(res.status).toBe(200);
    const names = (res.body as { employeeName: string }[]).map((e) => e.employeeName);
    expect(names).toContain("Carol");
    expect(names).not.toContain("Alice");
    expect(names).not.toContain("Bob");
  });
});

describe("PUT /employees/:id (real DB — cross-tenant IDOR check)", () => {
  it("tenant A cannot update tenant B's employee — returns 404", async () => {
    const target = await prisma.employee.findFirst({
      where: { tenantId: tenantB.id, employeeName: "Carol" },
      select: { id: true },
    });
    expect(target).not.toBeNull();

    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app)
      .put(`/employees/${target!.id}`)
      .send({ employeeName: "HIJACKED" });
    expect(res.status).toBe(404);

    const after = await prisma.employee.findUnique({ where: { id: target!.id } });
    expect(after?.employeeName).toBe("Carol");
  });
});
