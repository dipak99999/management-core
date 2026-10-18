// Real-database integration test for GET /customers.
//
// Contrast with customers.test.ts, which mocks Prisma. That gives us fast
// syntactic assertions ("the route calls findMany with a tenantId filter") but
// can't catch a class of bugs: a route that silently returns cross-tenant rows
// because its WHERE clause is wrong, or a schema change that makes the mocked
// shape lie.
//
// This suite spins up two tenants in `lumaara_test`, seeds each with its own
// customers, and asserts that a request authed as tenant A never sees tenant
// B's rows — the concrete tenant-isolation guarantee.
//
// Prerequisites: `lumaara_test` DB exists on localhost:5432 with migrations
// applied. See vitest.config.ts for the bootstrap commands.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

// Two isolated tenants — created once per suite, torn down at the end. Every
// business row cascades on tenant delete (per the schema), so the tenant-
// scoped cleanup is enough to leave the DB in a known state.
const suiteId = `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenantA: { id: string };
let tenantB: { id: string };

// Bound at runtime so the mocked perms middleware can flip which tenant's JWT
// the request carries — same test file exercises both isolation directions
// without spinning up multiple apps.
let currentTenantId: string;

vi.mock("@lumaara/service-auth", async () => {
  // Preserve real exports (some are pulled transitively at import time by
  // other modules the router graph touches) and override only perms + auth.
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
  const { customerRouter } = await import("./customers");
  const app = express();
  app.use(express.json());
  app.use("/customers", customerRouter);
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

  await prisma.customer.createMany({
    data: [
      { tenantId: tenantA.id, customerName: "Acme (A)", customerType: "Company" },
      { tenantId: tenantA.id, customerName: "Globex (A)", customerType: "Company" },
      { tenantId: tenantB.id, customerName: "Initech (B)", customerType: "Company" },
    ],
  });
});

afterAll(async () => {
  // Cascade removes customers, memberships, etc. Safe even if a test failed
  // mid-write.
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.$disconnect();
});

describe("GET /customers (real DB)", () => {
  it("returns only the calling tenant's customers (tenant A view)", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/customers");
    expect(res.status).toBe(200);
    const names = (res.body as { customerName: string }[]).map((c) => c.customerName).sort();
    expect(names).toEqual(expect.arrayContaining(["Acme (A)", "Globex (A)"]));
    // The negative assertion is the real point — tenant B's row must never leak.
    expect(names).not.toContain("Initech (B)");
  });

  it("returns only the calling tenant's customers (tenant B view)", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/customers");
    expect(res.status).toBe(200);
    const names = (res.body as { customerName: string }[]).map((c) => c.customerName);
    expect(names).toContain("Initech (B)");
    expect(names).not.toContain("Acme (A)");
    expect(names).not.toContain("Globex (A)");
  });
});

// ── Write-path tests. Reads correctly scoping by tenant is table stakes;
// the harder bugs live in create/update where a schema change or a missed
// tenantId on the write side can silently cross tenants.

describe("POST /customers (real DB — write path)", () => {
  it("creates a row scoped to the caller's tenantId — not from request body", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app)
      .post("/customers")
      .send({
        customerName: "New Corp (A)",
        // Attacker-supplied tenantId in body — must be ignored, JWT wins.
        tenantId: tenantB.id,
      });
    expect(res.status).toBe(201);
    const created = res.body as { id: string; tenantId: string; customerName: string };
    // The critical assertion: the row is attached to the CALLER's tenant,
    // not whatever the request tried to claim.
    expect(created.tenantId).toBe(tenantA.id);
    expect(created.tenantId).not.toBe(tenantB.id);
    // Verified in the DB, not just the response.
    const row = await prisma.customer.findUnique({ where: { id: created.id } });
    expect(row?.tenantId).toBe(tenantA.id);
  });
});

describe("PUT /customers/:id (real DB — cross-tenant IDOR check)", () => {
  it("tenant A cannot update tenant B's customer — returns 404 (not 403, don't confirm existence)", async () => {
    // Grab a real tenant-B customer id.
    const targetB = await prisma.customer.findFirst({
      where: { tenantId: tenantB.id, customerName: "Initech (B)" },
      select: { id: true },
    });
    expect(targetB).not.toBeNull();

    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app)
      .put(`/customers/${targetB!.id}`)
      .send({ customerName: "HIJACKED" });
    expect(res.status).toBe(404);

    // Verify: the row's name did NOT change.
    const after = await prisma.customer.findUnique({ where: { id: targetB!.id } });
    expect(after?.customerName).toBe("Initech (B)");
  });

  it("tenant A can update tenant A's own customer", async () => {
    const own = await prisma.customer.findFirst({
      where: { tenantId: tenantA.id, customerName: "Acme (A)" },
      select: { id: true },
    });
    expect(own).not.toBeNull();

    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app)
      .put(`/customers/${own!.id}`)
      .send({ customerName: "Acme (A) — updated" });
    expect(res.status).toBe(200);

    const after = await prisma.customer.findUnique({ where: { id: own!.id } });
    expect(after?.customerName).toBe("Acme (A) — updated");
    expect(after?.tenantId).toBe(tenantA.id); // still their tenant
  });
});
