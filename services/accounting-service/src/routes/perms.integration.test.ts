// Real-perms integration test. All the *.integration.test.ts files in this
// service inject `role: "admin"` (or no role) so `requirePerm` short-circuits
// via the SystemManager bypass. That's fine for testing tenant scoping but
// bypasses the actual permission-check code path.
//
// This suite does the opposite: seeds a real User + Role + RolePermission
// row per tenant, injects auth with NO role bypass, and asserts:
//   1. Requesting a doctype:action combo the user's roles do NOT grant → 403.
//   2. Requesting one they DO grant → 200.
//   3. A read-only user cannot POST (even if they can GET).
//
// This is the "will fine-grained roles actually block requests" guarantee
// the other tests don't cover.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-perms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenant: { id: string };
// The 3 users; each gets a different permission profile.
let readerUserId: string;
let writerUserId: string;
let noPermsUserId: string;
// Router-scoped state — swapped by tests.
let currentUserId: string;

// perms() is NOT mocked — the real implementation runs against real DB.
// We only need to inject req.auth so requirePerm has something to work with.

async function buildApp() {
  const { customerRouter } = await import("./customers");
  const app = express();
  app.use(express.json());
  // Test-only auth shim. Sets req.auth with the currentUserId but with NO
  // role bypass — requirePerm will hit the DB just like production.
  app.use((req, _res, next) => {
    (req as unknown as { auth: { tenantId: string; userId: string; roles: string[] } }).auth = {
      tenantId: tenant.id,
      userId: currentUserId,
      roles: [],
    };
    next();
  });
  app.use("/customers", customerRouter);
  return app;
}

beforeAll(async () => {
  tenant = await prisma.tenant.create({
    data: { name: suiteId, slug: suiteId },
    select: { id: true },
  });

  // 3 users, distinct permission profiles.
  const reader = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `reader-${suiteId}@x.com`,
      passwordHash: "x",
      fullName: "Reader",
    },
    select: { id: true },
  });
  const writer = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `writer-${suiteId}@x.com`,
      passwordHash: "x",
      fullName: "Writer",
    },
    select: { id: true },
  });
  const noPerms = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `noperms-${suiteId}@x.com`,
      passwordHash: "x",
      fullName: "No Perms",
    },
    select: { id: true },
  });
  readerUserId = reader.id;
  writerUserId = writer.id;
  noPermsUserId = noPerms.id;

  // Two roles: CustomerViewer (read only), CustomerEditor (read+create+write).
  // noPerms user gets neither.
  const viewer = await prisma.role.create({
    data: { tenantId: tenant.id, roleName: `CustomerViewer-${suiteId}` },
    select: { id: true },
  });
  const editor = await prisma.role.create({
    data: { tenantId: tenant.id, roleName: `CustomerEditor-${suiteId}` },
    select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: [
      { tenantId: tenant.id, roleId: viewer.id, doctype: "Customer", action: "read" },
      { tenantId: tenant.id, roleId: editor.id, doctype: "Customer", action: "read" },
      { tenantId: tenant.id, roleId: editor.id, doctype: "Customer", action: "create" },
      { tenantId: tenant.id, roleId: editor.id, doctype: "Customer", action: "write" },
    ],
  });
  await prisma.userRole.createMany({
    data: [
      { userId: reader.id, roleId: viewer.id },
      { userId: writer.id, roleId: editor.id },
      // noPerms user gets NO role.
    ],
  });

  // One customer to read.
  await prisma.customer.create({
    data: { tenantId: tenant.id, customerName: `PermsCust-${suiteId}` },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenant.id } });
  await prisma.$disconnect();
});

describe("perms enforcement (real DB, no admin bypass)", () => {
  it("user with no role → 403 on GET /customers", async () => {
    currentUserId = noPermsUserId;
    const app = await buildApp();
    const res = await request(app).get("/customers");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it("user with CustomerViewer role → 200 on GET /customers", async () => {
    currentUserId = readerUserId;
    const app = await buildApp();
    const res = await request(app).get("/customers");
    expect(res.status).toBe(200);
    const names = (res.body as { customerName: string }[]).map((c) => c.customerName);
    expect(names).toContain(`PermsCust-${suiteId}`);
  });

  it("user with CustomerViewer (read-only) → 403 on POST /customers", async () => {
    currentUserId = readerUserId;
    const app = await buildApp();
    const res = await request(app)
      .post("/customers")
      .send({ customerName: "SHOULD-BE-DENIED" });
    expect(res.status).toBe(403);
    // Row must NOT have been created.
    const check = await prisma.customer.findFirst({
      where: { tenantId: tenant.id, customerName: "SHOULD-BE-DENIED" },
    });
    expect(check).toBeNull();
  });

  it("user with CustomerEditor role → 201 on POST /customers", async () => {
    currentUserId = writerUserId;
    const app = await buildApp();
    const res = await request(app)
      .post("/customers")
      .send({ customerName: `WriterCust-${suiteId}` });
    expect(res.status).toBe(201);
    const check = await prisma.customer.findFirst({
      where: { tenantId: tenant.id, customerName: `WriterCust-${suiteId}` },
    });
    expect(check).not.toBeNull();
  });
});
